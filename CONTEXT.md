# CONTEXT.md — legendflow 領域語彙

本檔只放**領域詞彙**，不放實作細節。實作決策寫在 `docs/adr/`，架構說明寫在 `docs/architecture/`。
新增或改寫詞彙時當場更新此檔，不要累積。

## 角色（Roles）

| 詞彙 | 定義 | 不要說成 |
| --- | --- | --- |
| **Advisor（分析師）** | 發布單筆**訊號（Signal）**的專家，UI 主色 primary。 | 老師、投顧 |
| **Mentor（導師）** | 以**週記（Journal）**為單位發布教學＋操作的專家，UI 主色 `bg-mentor`（藍）。 | 分析師 |
| **Expert（專家）** | Advisor 與 Mentor 的上位詞，對應 `experts` 資料列與 `expert_slug`。 | 用戶、KOL |
| **Subscriber（訂閱者）** | 對某 Expert 有**有效訂閱**的會員。 | 客戶、粉絲 |
| **Member（會員）** | 已註冊帳號但未必有訂閱者身分。Email 與 Line 身分嚴格隔離。 | 使用者（過於模糊） |

## 交易（Trading）

| 詞彙 | 定義 |
| --- | --- |
| **Signal（訊號）** | Expert 對某標的的一次公開操作宣告，含方向、數量、單位、參考價。 |
| **Action（操作方向）** | `buy / add / trim / sell / exit / hold`，對外文案唯一來源為 `src/lib/signalAction.ts`。 |
| **Journal（週記）** | Mentor 的一週彙整；可為 `teaching`（純教學，無交易）或含交易的週記。 |
| **Trade Record（持倉紀錄）** | 由 Signal 落成的實際部位，`status` 為 `open` / `closed`。 |
| **Base Unit（基準單位）** | 資料庫一律以**股／顆／口／組**儲存數量；「張」只是台股 UI 顯示層（1 張 = 1000 股）。見 ADR-0003。 |
| **Combo（組合單）** | 美股選擇權價差單，`is_combo = true`，腿位在 `expert_signal_legs`，單位為「組」，風險以最大損失計。 |
| **Authoritative Price（權威價）** | 由 DB 同步任務落地的收盤／即時價，前台唯一可信價源。見 ADR-0002。 |
| **Publishing Window（發布視窗）** | 台股週五 20:00（台北）、美股週六 08:00（台北）統一開放；提前發布需按鈕明示。 |

## 持倉看板（Checkup）

| 詞彙 | 定義 |
| --- | --- |
| **Deep Module（深模組）** | 持倉看板的五個對外邊界：**Holdings / Closing / Events / TradeIO / Research**。介面 = barrel。見 ADR-0001。 |
| **Shell（協調層）** | 承載路由、Provider 與 **Shell Event Bus** 的外殼，模組之間唯一允許的耦合點。 |
| **Chips（籌碼面）** | 台股分點與三大法人買賣超資料，來源 TWSE T86 / BSR，落地為 `tw_chips_rollup` 快照。 |
| **Closing Analysis（收盤分析）** | 盤後針對個股產生的分析報告（M2 Closing 模組）。 |
| **Catalyst Event（催化事件）** | 影響持股的行事曆事件與新聞事件（M3 Events 模組）。 |

## 訂閱與金流

| 詞彙 | 定義 |
| --- | --- |
| **Manual Renewal（手動續訂）** | 單次扣款模型，無自動扣款；到期即斷、無寬限期。 |
| **Active Subscription（有效訂閱）** | 依 `logic/subscription/active-status-definition` 判定，續訂路徑不得被 `subscriberOnly` 守衛擋下。 |
| **Checkout Path（結帳路徑）** | 唯一產生方式為 `renewalUrl()` / `checkupRenewalUrl()`（前後端各一份 `routes.ts`）。 |
