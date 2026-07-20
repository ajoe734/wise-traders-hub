## 目標
降低 TWSE BSR 抓取被擋 / OCR 失敗率，從「單次硬打」升級成「排程節流 + 智慧退避 + 佇列化」的長跑架構，讓失敗自動延後、成功率能穩定 > 90%。

## 現況痛點（已確認）
- `tw-bsr-daily-sync` 一次 for-loop 連續打 N 檔 × 3 次 OCR，同一 IP、同一 UA、無間隔。
- OCR 失敗只寫 `tw_bsr_fetch_failures`，沒有下一次重試時間、沒有退避、沒有優先級。
- Cron 若同時觸發，多實例會平行打 TWSE，加速被擋。
- Menu 每檔都重抓 `__VIEWSTATE` / captcha，浪費請求也放大特徵。

## 解法總覽（六層防禦）

### 1. 請求節流層（單次呼叫內）
- 每檔之間 sleep `2500–5000ms` 隨機 jitter；OCR 重試間 `1200–2500ms`。
- 每次 run 硬上限 `batch=8`（原 20 太貪），超過就下一輪 cron 再處理。
- 全域併發 = 1：Edge Function 開頭以 `tw_bsr_sync_locks` 表加分散鎖（`INSERT ... ON CONFLICT`＋TTL 90s），避免兩個 cron 撞在一起。

### 2. 請求特徵層（降低被識別）
- UA 池（5–8 組桌面版 Chrome/Safari/Firefox）＋ `Accept-Language`、`sec-ch-ua` 隨機。
- 保留 cookie jar 跨股票沿用（同 session 5–10 檔後強制丟棄重建），減少 menu.aspx 重複請求。
- 每檔股票以「menu → captcha → post → content」完整鏈路帶 Referer；不省略中間步驟。

### 3. 智慧退避層（跨執行）
新增欄位到 `tw_bsr_fetch_failures`：
- `next_retry_at timestamptz`
- `backoff_seconds int`（指數退避：60 → 300 → 1800 → 7200，最長 6h）
- `consecutive_failures int`

排程只挑 `next_retry_at IS NULL OR next_retry_at <= now()` 的股票；失敗時依 `consecutive_failures` 遞增 backoff。連續 4 次以上該股票暫停 24h。

### 4. 佇列 / 優先級層
排程來源改為優先級佇列：
1. 有真人持倉的股票（join `trade_records` 未平倉）優先。
2. 過去 30 天曾被查看 `tw-chips-detail` 的熱門股次之。
3. `tw_institutional_daily` 近 7 日的其他股票墊底。

每輪 cron 只跑 `batch=8`，用 `next_retry_at` 排序取前 8 檔；跑不到的下一輪自然接手。

### 5. 排程層（把負載攤開）
- 現在若集中在收盤後一次跑：改成 **每 5 分鐘一輪、batch=8**、只在 14:30–20:00 TPE 執行，一天約 40 輪 × 8 = 320 檔次，足夠涵蓋常用股票。
- 加上 `?window=off_hours` 特別模式（凌晨 02:00–06:00）跑失敗回補，那時 TWSE 流量低、被擋機率低。

### 6. 觀測層
- `tw_bsr_sync_metrics`（date, total, success, ocr_fail, http_block, empty, avg_latency_ms），寫在 `rebuildRollup` 之後。
- `tw-chips-detail` 已回傳 `bsr_last_failure`；再加 `next_retry_at`，前端可顯示「預計 14:35 重試」。
- OCR 失敗率若 15 分鐘內 > 60%，寫 `system_alerts` 提示調整 Vision prompt。

## Schema 變更
```sql
alter table tw_bsr_fetch_failures
  add column next_retry_at timestamptz,
  add column backoff_seconds int not null default 60,
  add column consecutive_failures int not null default 1;

create table tw_bsr_sync_locks (
  lock_key text primary key,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table tw_bsr_sync_metrics (
  bucket_at timestamptz primary key,
  total int, success int,
  ocr_fail int, http_block int, empty int,
  avg_latency_ms int
);
```
三張表全部 `GRANT` 給 `service_role`；不開 anon / authenticated。

## Edge Function 變更
- `supabase/functions/tw-bsr-daily-sync/index.ts`
  - 加 acquireLock/releaseLock。
  - 排程模式支援 `mode=queue`（讀佇列 + backoff）與現有 `stock_ids` 手動模式。
  - 抽 `randomUA()` / `sleepJitter()` / cookie jar 復用。
  - 失敗時計算 `next_retry_at = now() + backoff`、`backoff *= 5` 上限 21600s。
  - 成功時清除 backoff（`resolved_at=now()`、`consecutive_failures=0`）。
- `supabase/functions/tw-chips-detail/index.ts`
  - `bsr_last_failure` 附帶 `next_retry_at`。

## Cron 變更
- 移除任何現存「一次跑一大批」的 cron。
- 新增 `pg_cron`：`*/5 14-20 * * 1-5`（台北時間）觸發 `mode=queue&batch=8`。
- 新增 `*/30 2-6 * * *` 跑 `mode=queue&batch=15&window=off_hours` 補失敗。

## 前端變更（最小）
- `ChipsSection.tsx` 的琥珀提示條追加「將於 HH:MM 自動重試」文案（讀 `next_retry_at`）。

## 驗證
1. 手動 `POST /tw-bsr-daily-sync {mode:"queue"}` 三輪，觀察 `tw_bsr_sync_metrics`：success 率、http_block 是否 = 0。
2. `select stock_id, backoff_seconds, next_retry_at from tw_bsr_fetch_failures where resolved_at is null order by next_retry_at`：確認退避有效遞增。
3. 觸發鎖競爭：同時 curl 兩次，第二次應立即回 `{skipped: "lock_held"}`。
4. `ChipsSection` 手動打 2330 / 2317 / 大量冷門股，確認 fallback 顯示 + 重試時間。

## 不做
- 不引入外部 proxy 服務（成本 & 合規）。
- 不改 OCR 供應商（另案）。
- 不做 client 端輪詢佇列狀態（避免額外流量）。
