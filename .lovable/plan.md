# P0_THREE_ISSUES — 修正計畫（v2，含完整驗收條件）

HEAD `2adc128c`，working tree clean。盤點全程唯讀；本計畫核准前不改 code/DB、不 deploy/Publish、不發通知。

## A. 週記後台算數 — 根因與正式資料反例

根因：現金與損益口徑分散在三處各自實作（前端 `derive.ts`、DB trigger `enforce_signal_capital_limit`、DB trigger `handle_signal_trade`），且 `trade_records` 的 `quantity_unit` 標籤與實際數值不一致（股數被標成「張」）。

正式資料反例（彥愷 expert `13926bcc-...`）：

1. **00708L 期元大S&P黃金正2**（buy signal `9c995675`，quantity=2 張 @77.7）
   - 正確成本 = 77.7 × 2 × 1000 = **155,400**
   - 目前 `trade_records` 存 quantity=2000、`quantity_unit='張'` → 任何用「張×1000」口徑的消費者算成 77.7 × 2000 × 1000 = **155,400,000**（1000 倍）
2. **6706 惠特**（buy 1 張 @123 → sell 1 張 @143，已 closed）
   - 已實現獲利 = (143 − 123) × 1000 = **+20,000**
   - 目前前端 `src/pages/_signalEditor/derive.ts:152-190` 賣出分支以成本價釋放現金（`remaining += (before.avg || price) * before.qty`），現金只回收 **123,000**，20,000 獲利不進現金
3. **3006 晶豪科 / 6526 達發 / 3035 智原**（buy+sell 各一對，皆 published）
   - 這 6 筆 signal 在 `trade_records` **完全沒有列**（buy 的 `batch_id` 皆 null，屬 orphan）
   - 目前績效漏算三筆已結案交易：3006 (238−174)×1000 = **+64,000**、6526 (752−585)×500 = **+83,500**、3035 (207.5−169)×1000 = **+38,500**

### A 修正方案

- **Canonical calculator**：建立 `src/lib/signalTradeLogic.ts`（現金、成本、損益、報酬率）與對應 SQL 函式；**contract test vectors 單一資料源**（JSON 檔，含 00708L 1000 倍案例、6706 賣出回收現金、張/股換算、空值/0、部分賣出），TS vitest 與 SQL（pgTAP 或 scenario SQL）各自實作、跑同一組向量、結果逐值一致。
- **單位換算唯一邊界**：lot→share 只能在 calculator 入口的 `lotsToShares` 發生一次；`trade_records` 寫入後一律以股為內部單位（顯示層才再換張）。賣出現金一律用實際成交價 × 實際股數。
- **歷史資料**：不補寫、不 migration 正式資料；orphan / missing trade_records 只產生 **read-only diff report**（唯讀查詢頁或檔案），等你另行確認後才處理。
- **驗收**：fixture route `/e2e/signal-arithmetic-harness`（production-path、network hard-block、host gate），上述三反例輸入 → 正確輸出；既有 pending-journal-edit isolation 測試續過。

## B. 訂閱到期提醒 — 站內為完成條件

- 原始核心需求：老師進入/撰寫週記時看見站內提醒。**Email/LINE 非本輪完成條件，不得發送真實通知。**
- 證據：彥愷 9/14–9/18 五筆 `notifications.user_id = 2a49b906-...`（= `experts.user_id`），收件人正確；`notifications` 表無 `recipient_user_id`，實際欄位是 `user_id`。
- `subscriber_expiry_reminders` 5 筆的 `channels` 全為 `{}` → 多管道**未完成，不得宣稱完成**；呈現上必須分開「已建立 notification」與「實際送達」。
- **Harness 矛盾根因**：`/e2e/subscriber-expiry-reminder-harness` 為 fixture-only（`fixtures.ts:7`、`HarnessEntry.tsx:130,150`，`mutation_calls` 恆 0），marker 停在 V1 未隨功能升版；「今天先收起」是 localStorage（`lf.expiringSubscribersBanner.v1`），與 DB ack 無關。harness 從未驗證過 DB ack 路徑 —— 是驗收缺口，非 RPC `ack_subscriber_expiry` 不存在。
- **B 修正**：
  1. harness 升 V2（marker bump），新增 DB ack 情境 —— **只用安全 fixture/mock，不寫正式 DB**；正式資料以 read-only 查詢佐證。
  2. banner：「今天先收起」（localStorage，隔日重現）與「已聯繫」（DB ack，持續消失）分開呈現與分開測。
  3. **必測情境**：同一提醒重跑不重複（唯一鍵）；續訂後消失；DB ack 後持續消失；僅收起隔日重現；跨老師/跨 tenant ack 被拒。
  4. **consumer 驗收**：必須在真正的通知中心（鈴鐺）與 `/admin/:slug/signals` 撰寫頁實測呈現，不只獨立 harness。

## C. 手動刪除持倉 — 現況 MISSING，需 durable 資料模型

- 現況：無單一持倉刪除入口。`holdingsStore.js:125 removeHolding` 只是前端 filter；`LogTab.jsx:156` 是交易日誌刪除（會 replay 回滾）；`FreeCheckup.jsx:2922` 是整組清空。持倉真實儲存 = localStorage + 雲端 `checkup_storage` key `pf-holdings-v2`（正式 47 使用者），日曆鏡像 `pf-calendar-holdings`。
- 風險：`tradeLogOps.reconcileHoldingsWithTradeLog` 會用交易日誌 replay 持倉 —— 只刪持倉不處理排除，該檔會被 replay 復活（假刪）。
- **C 修正**：
  1. **Durable、owner-scoped 排除模型**：新表（如 `checkup_holding_exclusions`：user_id、symbol、excluded_at、唯一鍵 (user_id, symbol)，RLS 僅本人、service_role 管理）—— **只產出 migration 檔與測試，不套用正式環境**。刪除 = 寫入排除列 + 從 `pf-holdings-v2` 與日曆鏡像移除，同一操作失敗完整 rollback。
  2. 語意：不新增賣出交易；不動 `trade_records`、`user_performances`、starting capital、cash；只影響目前持倉與鏡像。
  3. **重新加入同股票必須明確清除排除標記**；截圖匯入遇到已排除股票時顯示提示（預設不匯入，使用者選擇後才清除標記並匯入）；手動重新新增同股票時先清除標記。
  4. **必測**：未授權刪除被拒；持久化失敗完整 rollback；刪除最後一檔；重複 symbol；刪除後 reload 仍消失；交易日誌 replay 不復活；重新加入可恢復；截圖匯入行為；其他持倉與帳務 fingerprint 完全不變。
  5. fixture route `/e2e/holding-delete-harness`（production-path、network hard-block、host gate，不走 demo seam）。

## 驗證與交付紀律

- 三項各有 production-path fixture route：signal arithmetic / subscriber reminder V2 / holding delete。
- 每階段回報：exact HEAD、diff 檔案清單、測試結果；跑 focused vitest、tsgo、module-boundaries、build。
- fresh Hosted Preview 全綠之前：不 Publish、不 deploy、不套 migration/cron、不寫正式 DB、不發真實通知。
- fresh Preview 全綠之後也先停下來回報，等你確認才進下一步。
