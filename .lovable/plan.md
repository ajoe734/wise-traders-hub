## 目標
證據驅動決定要不要做籌碼面抽屜的多層快取優化。先量測 24–48h，再依數據決定投入。

## Step 0：量測（本次執行）

### 加 telemetry（`useTwChipsDetail.ts` + `tw-chips-detail`）
前端 `trackRaw` 事件：
- `chips_fetch_start` — props: `stockCode`, `source`（`drawer_open` / `manual_refetch` / `polling`）
- `chips_memory_hit` — props: `stockCode`, `age_ms`
- `chips_memory_miss` — props: `stockCode`, `reason`（`no_entry` / `ttl_expired` / `stockCode_switch`）
- `chips_fetch_done` — props: `stockCode`, `duration_ms`, `bsr_freshness_status`, `payload_bytes`
- `chips_fetch_error` — props: `stockCode`, `error_code`

Edge Function（`tw-chips-detail`）在回應 header 加：
- `x-chips-cache: hit|miss|stale`
- `x-chips-source: rollup|raw_fallback|snapshot`

前端讀 header 一起送進 `chips_fetch_done`。

### 儀表板卡片（`/company/bsr-rate-limit`）
新增「Chips Cache Telemetry (24h)」：
- Memory hit ratio
- Edge KV hit ratio
- P50 / P95 fetch duration（miss only）
- Miss reason 分佈圓餅
- 每個抽屜開啟平均發出幾次網路請求

資料來源：既有 `traffic_events` 表（`trafficTracker` 已寫入）。

### 決策門檻（24–48h 後）
| 觀察結果 | 行動 |
|---|---|
| Memory hit > 80% 且 P95 miss < 500ms | 不做，關掉 telemetry |
| Reload miss 佔 miss > 60% | 做 sessionStorage（Step 1a） |
| TTL 到期 miss > 60% 且狀態為 `fresh` | 拉長 TTL + SWR（Step 1b） |
| 使用者切檔頻繁（stockCode_switch > 20%） | 加預取（Step 2） |

### 不做的事
- **不動**現有 5min memory TTL、Edge KV cache、SWR、sessionStorage。
- **不改** `useTwChipsDetail` 的資料流語意，只加 side-effect 記錄。

## Step 1+（暫緩）
Step 1a / 1b / 2 / 3 全部等 Step 0 數據出來再排。此計畫僅執行 Step 0。

## 交付物
1. `src/checkup/hooks/useTwChipsDetail.ts` — 5 個 telemetry 事件插樁
2. `supabase/functions/tw-chips-detail/index.ts` — 3 個 response header
3. `src/pages/company/BsrRateLimit.tsx` — 新增 Chips Cache Telemetry 卡片
4. `src/lib/trafficTracker.ts` — 若需要新 event 名稱白名單則補上（既有 `trackEvent` 已泛用，估計不用改）

## 技術細節
- 事件量估算：每個抽屜開啟平均 1–3 事件，日活抽屜開啟數 < 1000 → 每天 < 3000 events，遠低於 `traffic_events` 保留上限。
- Edge Function header 讀取：前端 `supabase.functions.invoke` 拿不到 raw Response，需改用 `fetch(INGEST_URL, ...)` 直接呼叫，或在 payload body 內回傳 `_cache_meta`。**選 payload body 方案**，避免動 supabase-js 呼叫方式。
- View-as 隔離：telemetry props 加 `is_view_as`，避免 admin 模擬拉高 miss 率。
