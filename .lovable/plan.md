# Preview Acceptance Plan A1（authenticated 前置稽核）

本輪為唯讀稽核結果 + 15:21 後的驗收腳本設計。未修改任何檔案／DB／cron，未 deploy／invoke／Publish，未開任何抽屜。

## 1. /holding-checkup auth 模型（已查證）

- 路由：`src/App.tsx:298` → `/holding-checkup` → `FreeCheckupPage`（`src/pages/FreeCheckup.jsx`），外層 `CheckupModeProvider`。
- 匿名可進站：未登入走 local/demo 分支（`src/hooks/useFreeCheckupBootstrap.js`，`sweepStaleLocalIfOwnerMismatch` + `loadScopedLocal`）。
- 登入後 cloud-first：`useFreeCheckupBootstrap.js:236` 從 `public.checkup_storage` 載入；寫回在 `FreeCheckup.jsx:724 / 2861 / 2863`（`upsert` on conflict `user_id,key`）。
- 儲存模型：`checkup_storage(user_id, key, data, updated_at)`，持倉鍵為 `pf-holdings-v2`（另有 `pf-calendar-holdings`、`pf-targets-v1` 等）。目前 production 有 35 個 user 具備 `pf-holdings-v2`。
- RLS（已讀 `pg_policies`）：四條政策全部 `authenticated` 且 `user_id = auth.uid()`；無 anon 讀取。
- Session persistence：Supabase JS 預設 localStorage（`sb-<ref>-auth-token`）。
- **目前 Preview session 未登入**：`LOVABLE_BROWSER_AUTH_STATUS=signed_out`。因此**現在沒有任何 production account 可由 Preview session 合法驗證**，authenticated 驗收 **BLOCKED**。

## 2. 既有測試帳號／storage state（已查證）

- repo 內**沒有** Playwright `storageState`、沒有寫死測試帳號、沒有 seed 出來的 auth 使用者。
- 只有 `e2e/live/*` 用環境變數：`E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD`（subscription live smoke，要求 `profiles.is_tester=true`）、`E2E_ADMIN_EMAIL/PASSWORD`、`E2E_SUPABASE_SERVICE_ROLE_KEY`。
- 本沙箱現況：`E2E_TEST_EMAIL`／`E2E_TEST_PASSWORD` 已設定；`E2E_ADMIN_*` 與任何 service_role key **未設定**。
- 安全評估：`E2E_TEST_*` 是專用測試帳號，不是真實使用者，但本輪禁止登入，故不使用。

### 不需 impersonation 的替代驗收（擇一，需你授權）

- **A. 純 server-side 證明**：用唯讀 SQL（`supabase--read_query`）對指定帳號的 `pf-holdings-v2` 逐檔列 BSR 新鮮度，完全不開瀏覽器。可證明「server 已有最新 BSR」，不能證明「前端 0 enqueue」。
- **B. 匿名 + demo 前端網路證明**：不登入直接進 `/holding-checkup`，以 demo/local 持倉走完整頁面載入，全程監控 network，證明「頁面載入 0 enqueue」。可證前端行為，持倉集合不是真實使用者的。
- **C. A + B 合併（建議）**：server 面用 A，前端面用 B，兩邊各自成立即可覆蓋你的驗收命題。
- **D. 完整 authenticated 端到端**：需要你明確授權其一（我不自行執行、不自行建帳號）：
  - D1：你在 Preview 自行登入指定帳號（session 會在下一輪注入），並告知該帳號 email 或 user_id；或
  - D2：授權我使用既有 `E2E_TEST_EMAIL/PASSWORD` 測試帳號登入 Preview（僅登入讀取，不寫入持倉）。

**BLOCKED 標記**：在你給出 D1 或 D2 之前，authenticated 驗收保持 BLOCKED；我需要的最小授權就是「一個可用帳號的識別（user_id 或 email）＋登入方式的明示同意」，不猜測、不代建。

## 3. 前端 call graph（未開抽屜時）

頁面載入 → 資料穩定，會發生的請求：

| 檔案 | 觸發 | 請求 | 性質 |
| --- | --- | --- | --- |
| `src/integrations/supabase/client.ts` | 掛載 | `POST /auth/v1/token?grant_type=refresh_token`、`GET /auth/v1/user` | 讀 |
| `src/hooks/useFreeCheckupBootstrap.js:236` | 登入後 hydrate | `GET /rest/v1/checkup_storage?user_id=eq…` | 讀 |
| `src/checkup/lib/authoritativeQuotes.ts` | 報價 hydrate | `current_prices` / `daily_price_snapshots`（或對應 function） | 讀 |
| `HoldingsWorkbench.tsx:105` → `useChipsBatch.ts:58` → `chipsRepository.fetchChipsBatch` | 可見持倉 sparkline | `POST /functions/v1/tw-chips-detail`（批次 codes） | 讀 |
| `useChipsBatch.ts:89` `prefetchChipsPayload` | **hover 才觸發**，不 hover 就沒有 | `POST tw-chips-detail` | 讀 |
| `PerfMetricsTracker.tsx` | 載入 | `perf_metrics` insert（遙測，非 BSR） | 寫（遙測） |

不會發生（已逐檔確認）：

- `enqueue_bsr_backfill`：唯一呼叫點 `src/checkup/hooks/useChipsBackfill.ts:72`，只被 `useChipsLifecycle.ts:84` 使用，而 `useChipsLifecycle` 唯一使用者是 `ChipsSection.tsx:167`（抽屜內元件）。未開抽屜不掛載。
- `ensure_bsr_queued` / `ensure_bsr_window`：前端已無呼叫點（`ChipsSection.tsx:192` 註記 P3 已移除），全 repo 僅型別與註解殘留。
- `tw-bsr-finmind-sync`：前端唯一呼叫點是 `src/pages/company/BsrRateLimit.tsx:84`（管理後台），checkup 前台完全不呼叫。
- `tw-chips-detail` 本身對佇列**只讀**（`index.ts:100`、`210` 皆為 `select`），不會 insert queue。
- 自動回補 `useChipsAutoBackfill` 亦掛在 `useChipsLifecycle` 內，同樣只有抽屜開啟才存在。

結論（待 15:21 後以實測確認）：**未開抽屜時理論 enqueue 次數 = 0**，頁面載入不 enqueue。

## 4. Browser network 驗收定義

- 監控自 `browser.new_context()` 起、**導航之前**就註冊 `context.on("request")` 與 `on("response")`，記錄 method + URL + POST body 前 200 字元，落地 JSON。
- 流程：（登入方式依 §2 授權結果）→ `goto /holding-checkup` → 等待 `networkidle` + 持倉表格 `data-testid` 出現 → 額外靜置 20 秒吸收延遲請求 → 截圖 → 關閉。全程**不點任何個股列、不 hover 個股**（滑鼠固定在頁面空白處）。
- 禁止清單（出現任一即 FAIL）：
  - `POST /rest/v1/rpc/enqueue_bsr_backfill`
  - `POST /rest/v1/rpc/ensure_bsr_queued`、`ensure_bsr_window`
  - `POST /rest/v1/rpc/enqueue_bsr_first_fetch_on_trade`、`enqueue_all_active_tw_holdings_bsr`、`enqueue_chips_prefetch_gaps`
  - `POST /functions/v1/tw-bsr-finmind-sync`、`tw-bsr-worker-hourly`、`tw-institutional-daily-sync`、`chips-guardian`
  - 任何對 `tw_bsr_sync_queue` / `chips_prefetch_targets` 的 `POST`/`PATCH`（REST 寫入）
- 允許清單：`/auth/v1/*` 讀、`GET /rest/v1/checkup_storage|current_prices|daily_price_snapshots|stock_names|tw_market_holidays`、`POST /functions/v1/tw-chips-detail`（讀取型批次）、靜態資產、`perf_metrics`/`traffic_*` 遙測寫入。
- 證明 enqueue count = 0：輸出「禁止清單命中數 = 0」的完整計數表 + 全部請求列表（去重後）作為證據，並附 server 端二次證明：驗收前後各查一次 `tw_bsr_sync_queue` 中 `created_at`／`updated_at` 落在觀測視窗內的列數，兩次差值必須為 0。

## 5. Server readiness SQL（唯讀，15:21 後執行）

對指定 authenticated user 的 `checkup_storage.data` (`key='pf-holdings-v2'`) 展開持倉代號，逐檔輸出：

1. `tw_bsr_eligibility(code)` → `eligible` / `ineligible_reason`（ETF、權證、非 4 碼一律標 `INELIGIBLE — 不計入 fresh/stale 分母`）。
2. `expected_latest_bsr_date()` → `expected_trade_date`（含 `tw_market_holidays` 判斷）。
3. `tw_bsr_daily` 該檔 `max(trade_date)` 與該日 row 數。
4. `bsr_coverage_daily` / `get_bsr_readiness_v2(code)` 的 coverage state 與 sealed 狀態。
5. 判定：`latest = expected` → FRESH；`latest < expected` → STALE（附落後交易日數）；無資料 → MISSING。
6. 彙總：FRESH／STALE／MISSING／INELIGIBLE 各自檔數與比率，附每檔明細表。

驗收命題成立條件：eligible 檔案 **全部 FRESH**（或 STALE 僅出現在 market-batch 明確標示 unsupported 的情況並註明），且 §4 禁止清單命中 = 0。

## 執行順序與界線

1. 15:21 自然 market-batch 週期完成後才開始（本輪與後續稽核都不觸碰 cron、不 manual invoke、不 deploy、不 Publish）。
2. 先跑 §5 唯讀 SQL，再跑 §4 browser 觀測。
3. 若 §2 授權未到位，authenticated 路徑輸出 **BLOCKED**，改以你選定的 A／B／C 替代方案執行並如實標註覆蓋範圍。
