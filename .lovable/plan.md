# P0_THREE_ISSUES — 盤點結論與修正計畫

HEAD `2adc128c`，working tree clean。本輪未改 code、未動 DB、未 deploy、未發任何通知。

---

## A. 週記後台算數錯誤 — PARTIAL（根因已鎖定）

根因：現金口徑前後端與 DB trigger 三處各算一次，且張/股單位在兩張表不一致。

- `src/pages/_signalEditor/derive.ts:152-190` `computeCashSim` 賣出分支用成本價釋放現金（`remaining += (before.avg || price) * before.qty`），不是實際賣出價。
- DB trigger `enforce_signal_capital_limit`：買進檢查用 `price_hint × (張 ? quantity*1000 : 1)`，與前端 cashSim 不同源。
- DB trigger `handle_signal_trade` 只建 `trade_records`，不扣款，所以資金只由上面兩處各自推導。

正式資料反例（彥愷）：

1. 00708L：`expert_signals.quantity = 2`（張），`trade_records.quantity = 2000`（股），單位換算不一致，部位%與報酬率擇一來源就會差 1000 倍級距。
2. 6706 賣出信號：`expert_signals` 有列，`trade_records` 無對應列 → 已實現損益缺一筆。
3. 3006 / 6526 / 3035：`batch_id` 為 null 的 orphan signals，無任何 trade_records → 持倉與資金皆漏算。

最小修正：把 `derive.ts` 的現金推導與單位換算收斂成單一 canonical calculator（`src/lib/signalTradeLogic.ts`），賣出以成交價計、買進以 `lotsToShares` 統一換股數；trigger 改為呼叫同一口徑的 SQL 函式。orphan / 缺 trade_records 先出唯讀差異報表，不自動補寫。

---

## B. 訂閱到期通知 — PARTIAL（站內通道成立，其餘未在正式環境跑過）

- `notifications` 無 `recipient_user_id` 欄位，實際欄位是 `user_id`；彥愷 9/14–9/18 五筆的 `user_id = 2a49b906-...`，與 `experts.user_id` 一致 → 收件人正確、老師頁可見、跨老師不可見。
- `subscriber_expiry_reminders` 僅 5 筆，`channels` 全為 `{}`、`reminder_type` 全為 `subscriber_expiry_7d`；`subscriber_expiry_acks` 0 筆；churn_24h 0 筆。→ Email/LINE fan-out 與「昨日到期挽回」程式碼存在（edge function `subscriber-expiry-teacher-reminder`，327 行）但正式環境**從未產出資料**。
- 因此「三通道已上線」只成立在程式碼層，正式資料無證據；不重複寄送可證（每人每日一筆），續訂後消失可證（來源 RPC `_expiring_subscriptions_by_expert` 以有效訂閱過濾），**已聯繫後消失無法證**（acks 0 筆）。

### harness 矛盾的原因

`/e2e/subscriber-expiry-reminder-harness` 是 fixture-only 驗收頁：`src/pages/_subscriberExpiryHarness/fixtures.ts:7`、`SubscriberExpiryReminderHarnessEntry.tsx:130,150` 明定 fixture 模式不寫 DB、`mutation_calls` 恆為 0，marker 仍是 `SUBSCRIBER_EXPIRY_PREVIEW_V1`（建立時的版本，後續改動沒同步 bump）。所以它顯示的「今天先收起」是 `ExpiringSubscribersBanner` 的 localStorage 行為（`lf.expiringSubscribersBanner.v1`），不是 DB ack。harness 與正式行為本來就不同源 —— 它不能、也沒有驗證過 DB 持久化的「已聯繫」。這是驗收缺口，不是 DB 功能不存在（RPC `ack_subscriber_expiry` 確實存在）。

最小修正：harness marker bump 至 V2 並新增「DB ack 模式」情境；banner 的 localStorage dismiss 與 DB ack 分開呈現（收起僅當日、未 ack 隔日仍出現）；`subscriber_expiry_reminders.channels` 寫入實際送達結果後才可宣稱通道完成。

---

## C. 持倉看板手動刪除個股 — MISSING（無此功能）

- 目前只有：交易日誌單筆刪除（`LogTab.jsx:156`，走 `recomputeHoldingsAfterDelete` 回滾持倉）與整組資料清空（`FreeCheckup.jsx:3614/2922`）。沒有「刪除單一持倉」入口。
- `holdingsStore.js:125` 的 `removeHolding` 只是前端 filter，未接任何 UI，也不寫儲存。
- 持倉真實儲存：localStorage + 雲端 `checkup_storage` key `pf-holdings-v2`（正式環境 47 筆使用者資料），日曆鏡像 `pf-calendar-holdings`（46 筆），寫入點 `FreeCheckup.jsx:728,742`。
- 關鍵風險：`tradeLogOps.reconcileHoldingsWithTradeLog` 會用交易日誌 replay 持倉，若只刪持倉不處理日誌，該檔會被重新算回來（假刪）。

最小修正：在持倉卡加「移除此持倉」＋確認視窗；走既有 owner-scoped 儲存寫入（`pf-holdings-v2` + 日曆鏡像同步），並把該檔標記為 replay 排除，避免被日誌復活。不建立賣出交易、不動 `trade_records` / `user_performances` / 起始資金 / 現金；寫入失敗整批回滾。

---

## 分階段與驗收

| 階段 | 範圍 | Hosted Preview 正向驗收 | 反向驗收 |
| --- | --- | --- | --- |
| 1 | C 刪除持倉 | 刪除單檔後重整仍不在，其他檔數值不變 | 刪除後交易日誌 replay 不復活；`trade_records` 指紋不變 |
| 2 | B harness/ack | marker V2；按「已聯繫」後隔日仍不出現 | 「今天先收起」隔日必須再出現；跨老師看不到他人名單 |
| 3 | A 算數收斂 | 三個反例輸出改為資料口徑正確值 | 未發布 pending 編輯仍不得動帳本（既有 isolation 測試續過） |

每階段驗收含：focused vitest、tsgo、module-boundaries、build。
