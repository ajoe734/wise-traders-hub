# 計畫：Trade Records 異常自動去重／恢復排程

## 目標
針對「cooldown 未收斂 + 併發重送」造成的 `trade_records` 髒資料，建立一支背景排程，定時自動：
1. 掃描每個 `signal_id` 的重複列
2. 自動修復**無手動編輯痕跡**的乾淨重複（idempotent）
3. 對**有手動編輯**的個案掛出告警，交由管理員 `/company/signal-dupe-audit` 人工處理
4. 全程寫入結構化 log 與 alert，可追蹤誰做了什麼

不新增 Edge Function、不寫 TS——直接用 SQL RPC + pg_cron，最省失敗面。

## 交付檔案

### 1. Migration：`trade_dedupe_sweep()` RPC + cron 排程

```
supabase/migrations/<ts>_trade_dedupe_sweep.sql
```

包含：

- **`public.trade_dedupe_sweep(p_dry_run boolean default false) returns jsonb`**
  - `SECURITY DEFINER`, `search_path=public`
  - 使用 `admin_signal_dupe_trades_audit()` 取得所有重複個案
  - 對 `has_manual_edit=false` 者：逐一呼叫底層 DELETE 邏輯（保留最舊 `created_at`），並寫入 `audit_logs (action='signal_dupe_trade_auto_fix')`
  - 對 `has_manual_edit=true` 者：**不動**，累積成清單
  - `dry_run=true` 時只回報不執行
  - 每輪產出 `function_run_logs (fn='trade_dedupe_sweep')`：`stage='start'|'fixed'|'skipped'|'done'`，`payload` 帶 signal_id / kept_id / removed_ids
  - 若手動編輯個案 ≥ 1，插入/更新 `system_alerts (kind='trade_dedupe_manual_review_required', level='warning')`，含清單與計數；若本輪為 0 則自動 `resolved_at=now()` 收單
  - 若自動修復數異常（例如單輪 > 20 筆，暗示 trigger 破功）→ `system_alerts (level='critical', kind='trade_dedupe_surge')`
  - 回傳 jsonb：`{ scanned, auto_fixed, needs_review, alert_ids, run_id }`

- **cron 排程**：每 15 分鐘一次（避免與交易時段其他 job 撞車，仍能快速止血）
  ```sql
  select cron.schedule(
    'trade-dedupe-sweep-15min',
    '*/15 * * * *',
    $$ select public.trade_dedupe_sweep(false) $$
  );
  ```
  若已存在同名 job 則 `cron.unschedule` 後重排，保證冪等。

- **權限**：`GRANT EXECUTE ON FUNCTION public.trade_dedupe_sweep TO service_role;` 只給 service_role 與 company_admin。

### 2. 前端小改：`/company/signal-dupe-audit` 顯示最近一輪 sweep 結果

- 頂部新增一行「最近自動掃描：`{last_run_at}` · 修 `{auto_fixed}` · 待審核 `{needs_review}`」
- 資料來源：`function_run_logs where fn='trade_dedupe_sweep' and stage='done' order by created_at desc limit 1`
- 附「立即執行」按鈕（呼叫 `trade_dedupe_sweep(false)`）與「試跑」（`true`），僅 company_admin 可見
- 待審核清單直接呼叫 `admin_signal_dupe_trades_audit()` 過濾 `has_manual_edit=true`

檔案：`src/pages/company/SignalDupeAudit.tsx`（既有頁面追加區塊，不新建）。

## 涵蓋 cooldown/併發成因對應
| 成因 | 是否進 auto_fix | 說明 |
|---|---|---|
| trigger 在同秒重觸發插入 2 筆完全一致的 open | ✅ 是 | 值一致 → `has_manual_edit=false` |
| Retry 送出同一 signal，第二次寫入前 unique index 已阻擋 | ✅ 是 | 極少數逃逸案例仍會清 |
| 老師事後改過其中一筆 entry_price/quantity | ❌ 否，告警 | 需要人工判斷保留哪筆 |
| 舊 exit_date + 新 open 疊 signal_id | ❌ 否，告警 | 可能是實質新交易，人工判定 |

## 監控與告警
- `system_alerts` kind：
  - `trade_dedupe_manual_review_required`（warning，開/關自動翻）
  - `trade_dedupe_surge`（critical，單輪 auto_fix > 20）
- `function_run_logs` fn=`trade_dedupe_sweep`：每輪 start/done + 每筆 fixed/skipped
- 對接既有 `alerts-watchdog` → LINE/Email 通道無需改動，system_alerts 一寫入即被 watchdog 推播

## 不做的事
- 不自動修「手動編輯」個案（風險過高）
- 不改 `handle_signal_trade` trigger（既有存在性檢查已到位）
- 不新增 Edge Function（純 SQL 排程即可）

## 驗證
- 手動 `select public.trade_dedupe_sweep(true)` 觀察試跑結果
- 檢查 `select * from cron.job where jobname='trade-dedupe-sweep-15min'`
- 15 分鐘後在 `function_run_logs` 應看到 `stage='done'` 記錄
- `/company/signal-dupe-audit` 顯示最近執行摘要
