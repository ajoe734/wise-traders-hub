# 老師沒收到「訂閱者即將到期」通知 — 查證結果與根治方案

## 一、查證結果：部分屬實

系統**有**發，但發在老師看不到的地方。

實際資料（彥愷，expert `13926bcc…`）：

| 日期 | 站內通知 | 內容 | 已讀 |
|---|---|---|---|
| 09/14 | 有 | 5 位（夢旅人、吳俊賢、Huang、Jing、Roger） | 未讀 |
| 09/15 | 有 | 4 位 | 未讀 |
| 09/16 | 有 | 3 位 | 未讀 |
| 09/17 | 有 | 2 位 | 未讀 |
| 09/18 | 有 | 2 位（Roger 今日到期、云云剩 7 天） | 未讀 |

排程 `subscriber-expiry-teacher-reminder-hourly` 每小時執行、狀態全部 ok，沒有失敗。

**真正的四個缺口：**

1. **只有站內鈴鐺，沒有任何外部通道。** 老師沒登入後台就等於沒通知。彥愷沒有 LINE 綁定，也從未收過到期相關 Email。
2. **一天只有一次、且只在台北 18:05。** 錯過當天就沒有第二次提醒。
3. **只涵蓋「7 天內即將到期」。** 到期當天之後（已流失）完全不再提醒，老師無從知道誰掉了。
4. **功能 09/14 才上線。** 截圖中 09/06 到期的廖基富，系統當時根本沒有這條提醒，屬歷史空窗。

另外：寄信服務（Resend）金鑰目前無效，會員端的續訂提醒信也一封都寄不出去 — 這是外部通道要能用的前提。

## 二、根治方案

### A. 多通道送達（核心）
老師的到期提醒不再只寫站內通知，同一份名單同時送：
- **站內通知**（維持現狀）
- **Email** 給老師本人（T-7 一次彙總、T-1、到期當天、過期後 24 小時各一次）
- **LINE**（老師若已綁定平台 LINE 帳號則同步推播；未綁定時在後台顯示綁定引導）

同一批名單共用一次 dedupe 帳本，任何通道都不會重複轟炸。

### B. 補上「已流失」提醒
新增「過期後 24 小時」的挽回提醒：列出昨天到期且未續訂的訂閱者，附一鍵進入續訂連結，讓老師可以主動聯繫。

### C. 老師後台常駐可見
- 老師撰寫週記頁的到期橫幅改為「未處理就不消失」：只有續訂、手動標記已聯繫、或該訂閱者流失超過 30 天才移除，不再只是「今天先收起」。
- 訂閱者管理頁新增「通知送達」欄位：每位訂閱者顯示站內／Email／LINE 三個通道各自的送達或失敗狀態與時間，一眼看出有沒有真的送到。

### D. 送達可稽核 + 失敗自動告警
- 每次送出都寫 `audit_logs`（通道、days_left、成功／失敗、錯誤訊息）。
- 任何通道連續失敗（例如寄信金鑰無效）在 24 小時內自動產生系統警示，後台立刻看得到，不會像這次靜默失效。

### E. 前提條件
Resend 金鑰必須換新（`re_` 開頭）。金鑰恢復前，Email 通道會以「待寄」狀態排隊，恢復當天自動補寄，不會遺漏。

## 三、技術細節

- 擴充 `claim_subscriber_expiry_reminders` 的 ledger：`subscriber_expiry_reminders` 增加 `channels jsonb`（各通道送達狀態），dedupe 鍵維持 `expert_id + local_date + reminder_type`，新增 `reminder_type = 'subscriber_expiry_churn_24h'`。
- Edge function `subscriber-expiry-teacher-reminder` 擴為三通道 fan-out：站內 `notifications`、Email 走既有寄信管線、LINE 走 `_shared/linePushCore`（遵守單一資料源憲法）。每通道獨立 try/catch，單一通道失敗不影響其他通道，失敗寫 `audit_logs` 並允許下一小時重試。
- 老師 Email 位址從 `auth.users` 取得（service role），不落地到 public schema。
- 橫幅狀態改由 DB 的「已處理」欄位決定，取代目前 localStorage 的 per-day dismiss（`subscriberExpiryReminder.ts` 的 dismiss helpers 保留給 UI 折疊用）。
- 新增／更新測試：`claim` RPC 情境 SQL、edge function Deno 測試（三通道成功／部分失敗／全失敗）、`Subscribers.tsx` 通知送達欄位的 RTL 測試、harness 情境補 churn 24h。
- 所有排程沿用既有每小時 `5 * * * *`，不新增 cron。

## 四、回補
上線後對 09/06–09/18 之間已到期、未續訂的彥愷訂閱者產生一次性彙總（Email + 站內），把歷史空窗補齊。
