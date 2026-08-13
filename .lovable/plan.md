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
- 安全評估：`E2E_TEST_*` 是專用測試帳號，不是真實使用者。**D2 已獲授權**（僅登入 + 唯讀觀測）。

### D2 帳號唯讀盤點結果（本輪已查，未登入）

查法：本地對 `E2E_TEST_EMAIL` 取 md5，僅以雜湊比對 `auth.users`；聊天／查詢／證據皆不出現 email、password、token 或完整 user_id。

- `user_found = 1`，masked account id = `f2fe…19c1`。
- `public.checkup_storage` 該帳號 **0 筆列**（`storage_keys = none`），因此**沒有 `pf-holdings-v2`**、持股檔數 0、無代號可列。

**判定：authenticated holdings acceptance = BLOCKED。** 不自行新增持股、不寫入 `checkup_storage`。15:21 後僅能完成：

- S-α：**authenticated page 0-enqueue**（以此帳號登入 Preview，空持倉狀態下觀測 network）。
- S-β：**market-wide server coverage**（全市場 eligible 個股的 server 端 BSR 新鮮度）。
- 逐持股 PASS **不會宣稱**。若要覆蓋逐持股，需你另行提供：(a) 一個已有 `pf-holdings-v2` 的帳號識別並由你在 Preview 登入（D1），或 (b) 明示授權為測試帳號寫入持股（本輪明文禁止，預設不做）。


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

因測試帳號無持股，逐持股段改為 **market-wide server coverage（S-β）**，以全市場 eligible 個股為母體逐檔輸出：

1. `tw_bsr_eligibility(code)` → `eligible` / `ineligible_reason`（ETF、權證、非 4 碼標 `INELIGIBLE — 不計入 fresh/stale 分母`）。
2. `expected_latest_bsr_date()` → `expected_trade_date`（含 `tw_market_holidays`）。
3. `tw_bsr_daily` 該檔 `max(trade_date)` 與該日 row 數。
4. `bsr_coverage_daily` / `get_bsr_readiness_v2(code)` 的 coverage state 與 sealed 狀態。
5. 判定：`latest = expected` → FRESH；`latest < expected` → STALE（附落後交易日）；無資料 → MISSING。
6. 彙總 FRESH／STALE／MISSING／INELIGIBLE 檔數與比率 + coverage %，附 Top-N STALE 明細（僅股票代號，無 PII）。

驗收命題：S-α（authenticated 頁面 0 enqueue）與 S-β（market-batch 後全市場覆蓋率達成）分別成立；**逐持股 PASS 標為 BLOCKED，不宣稱**。

## 執行順序與界線（15:21 之後）

1. **T0 before snapshot（先於登入）**：唯讀記錄 queue observation window 起點 —
   `select count(*), max(created_at), max(updated_at) from tw_bsr_sync_queue`，並記錄 `now()` 為 `t_start`。
2. **登入 Preview**：以 D2 測試帳號在 Playwright 內登入（帳密只從 `os.environ` 取，不落 log／不截圖到輸入框內容）。
3. **S-α network 觀測**：導航前註冊 request/response 監聽 → `goto /holding-checkup` → `networkidle` → 靜置 20 秒 → 截圖（不含帳號列）。全程滑鼠不進入個股列，不 hover、不點、不開抽屜。
4. **T1 after snapshot**：再查一次 §1 的 queue 指標，並計 `count(*) where created_at > t_start or updated_at > t_start`，**delta 必須 = 0**，否則 FAIL。
5. **checkup_storage 零變更證明**：`t_start`／`t_end` 各查一次該 masked 帳號的 `checkup_storage` 列數與 `max(updated_at)`；出現任何 mutation 立即 **FAIL/STOP**。
6. **S-β**：跑 §5 全市場唯讀 SQL。
7. `perf_metrics` / `traffic_*` 等自動遙測若無法阻擋，記錄為「非 BSR 寫入」並列於報告附註。
8. 全程不觸碰 cron、不 manual invoke、不 deploy、不 Publish、不改任何檔案與 schema。
9. 證據一律用 masked account id `f2fe…19c1`；network dump 前先過濾 `Authorization`、`apikey`、`access_token`、`refresh_token`、email 欄位。

