
## 根因（已驗證）

Benny (`experts.id=e381e144…`, `asset_class=us_stock`, `currency=USD`, `starting_capital=30000`, `status=pending`) 目前：
- `expert_signals` 0 筆、`trade_records` 0 筆、`function_run_logs` 0 筆。
- RLS policy `Analysts can insert own signals` 條件符合（user_id 相符），與 RLS 無關。

真正擋人的是 **BEFORE INSERT trigger `enforce_signal_capital_limit_trg`** → `public.enforce_signal_capital_limit()`：

1. 它對 **`status IN ('published','pending')` 且 `action IN ('buy','add')`** 全部啟用。
2. `SignalCreateDialog.handlePublish` 對 mentor 一律送 `status='pending'`（週五統一發布），所以**連草稿都被擋**。
3. 額度用 `experts.starting_capital` 直接當「可用現金」，Benny 只設 30,000 USD，任何一筆美股買進金額只要 ≥30,000 就會被丟 `CAPITAL_EXCEEDED`；訊息中金額顯示原始數字（無幣別），mentor 不會意識到要調高 starting_capital，UI 也沒把 DB 例外翻成人話——只顯示 raw `error.message`（`SignalCreateDialog.tsx` L287：`toast.error(error.message)`）。

這就是「Benny 週記發不出去」持續無解的實際卡點。

## 修法（三段，最小侵入）

### 1. DB trigger 只在真正對外發布時檢查（migration）

改寫 `public.enforce_signal_capital_limit()`：
- `pending` 直接放行（草稿／週五統一發布前的暫存不該擋）。
- 保留 `published` 才檢查，並在 `UPDATE` 由 `pending → published` 的路徑也套用（BEFORE INSERT OR UPDATE），避免有人繞過。
- 例外訊息帶上幣別（讀 `experts.currency`）與 hint：
  `CAPITAL_EXCEEDED: 此筆需 21000 USD，可用現金僅 9000 USD。請至「分析師設定」調整初始資金，或減少數量。`
- 保留 company_admin bypass。

### 2. 前端把 DB 例外翻成人話（`SignalCreateDialog.tsx`）

L287 目前 `toast.error(error.message)`。加一個 mapper（同檔內小 helper 即可，不新增檔案），對常見 code / message 前綴翻譯：

| 觸發 | 對外訊息 |
|---|---|
| `CAPITAL_EXCEEDED` | 顯示原例外中已帶幣別的說明，並附「前往分析師設定 →」按鈕（`toast.error` + action） |
| `incompatible_unit_for_asset_class` | 已存在，維持 |
| `unit_conflict` / `enforce_unit_consistency` | 「此代碼歷史單位為 X，請改用 X 或先執行『改單位…』」 |
| 其他 | 原訊息 |

### 3. 分析師設定顯示幣別與最小建議值

`StartingCapitalCard.tsx` 在 `asset_class=us_stock/crypto/us_option/us_future` 時，label 補上幣別（USD）並顯示 placeholder「建議 ≥ 100,000」，避免下一位老師重複踩雷。**不改鎖定邏輯**（已修過）。

## 驗證

- 手動：以 Benny 身份送 `buy AAPL 100 @ 210`（USD 21,000 < 30,000）→ 應成功 pending；送 `buy NVDA 200 @ 170`（34,000 > 30,000）→ 應收到帶幣別的中文錯誤，並看到「前往分析師設定」按鈕。
- 新增 vitest：`enforce_signal_capital_limit` 的四種 case（pending buy 放行、published buy 超限擋、published buy 未超限放、admin bypass）以 pgTAP 或 SQL fixture 覆蓋（`supabase/tests/`）。
- 既有 E2E `e2e/live/realign-instrument-unit.spec.ts` 不受影響（未觸及 buy/add 額度）。

## 不做

- 不改 `starting_capital` 的預設或既有值（由 mentor 自訂）。
- 不動 `handle_signal_trade` / `enforce_unit_consistency`（此次無關）。
- 不改 `ExportRiskDialog` / 週記匯出（Benny 目前無 signals，跟匯出無關）。
