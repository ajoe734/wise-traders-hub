
# Wave 4 — 訂閱轉換 P0 細部規格

聚焦四件高 ROI 任務。每件都明確列出資料模型、觸發條件、edge function、UI 與驗收。

---

## W4-1｜續訂提醒漏斗強化

### 現況盤點
- ✅ `line-push-renewal-reminder`：已支援 T-7/3/1 Flex Message，含 idempotency 與 audit log。
- ❌ **無 Email 續訂提醒**：`subscribe-renew-link` 只產生 token URL，沒人定時呼叫寄信。
- ❌ Email 模板缺「上期績效摘要 + 一鍵續訂 CTA」。
- ❌ `/account` banner 沒有「過期 24h 內回購保留資料」訊號（檢查 `src/pages/account/`）。
- ❌ T-0（當日到期）、T+1（已過期）沒有最後召回。

### 規格
**1. 新增 `email-push-renewal-reminder` edge function**
- 排程：每日 09:10 (UTC+8)，pg_cron。
- 觸發窗口：`expires_at` 落在 T-7 / T-3 / T-1 / T+1 四個 24h 窗口（T+1 為「剛過期召回」，僅 24h 內）。
- 對象：`member_subscriptions.status='active' AND canceled_at IS NULL`（T+1 改抓 `status='expired' AND expires_at > now()-interval '24h'`）。
- 來源：抓 `profiles.email`，跳過 `line_{id}@line.local` 虛擬 email。
- 內容：呼叫 Resend，模板含
  - Header：剩餘天數 / 已過期天數
  - Body：專家名、方案名、到期日、續訂金額
  - 績效摘要：最近 30 天 `user_performances` 該專家數據（命中率、平倉筆數）
  - CTA：`/{slug}/checkout?plan={id}&utm_source=email&utm_medium=renewal&utm_campaign=d{N}`
- Idempotency：同 line-push 模式，audit_logs `action='subscription.renewal_email_sent'` + `detail.days_left`。
- 跳過條件：用戶 `notification_preferences.renewal_email = false`（若欄位不存在則新增 migration）。

**2. Line Flex 補 T-0 / T+1 兩個窗口**
- `line-push-renewal-reminder` 的 `REMINDER_DAYS` 從 `[7,3,1]` 擴充為 `[7,3,1,0,-1]`（負數代表已過期）。
- T-0 文案：「⚠️ 訂閱今日到期」；T+1 文案：「訂閱已過期 — 24h 內回購保留歷史持倉與訊號訂閱紀錄」。

**3. `/account` Account Banner**
- 顯示條件：使用者任一訂閱 `expires_at ≤ now()+7d` OR `status='expired' AND expires_at > now()-24h`。
- 內容：剩餘天數、一鍵續訂按鈕（同 utm tag）、過期者顯示「24h 內回購可保留歷史資料」。
- 元件：`src/components/account/RenewalBanner.tsx`（新檔）。

### 驗收
- `email-push-renewal-reminder` 手動觸發回傳 `reminded` 計數正確。
- Audit log 同日同 sub 同窗口僅一筆。
- T+1 召回不對已續訂者重複發。

---

## W4-2｜Checkout 棄單回收

### 資料模型現況
- `payment_intents`：建立 intent 即寫入，**無 status 欄位**。
- `payment_transactions`：成功/失敗交易結果，FK 到 `member_subscriptions` 不是 intent。
- 判定「棄單」邏輯：`payment_intents.created_at > T-2h AND created_at < T-30min` 且不存在 `payment_transactions WHERE provider_tx_id LIKE '%{trade_no}%' OR matching`。

### 規格
**1. 新增 `recover-abandoned-checkout` edge function**
- 排程：每 30 分鐘 pg_cron。
- 掃描窗口：`payment_intents.created_at` 落在 `[now-2h, now-30min]`。
- 判定未完成：左連 `payment_transactions`，無 `status='success'` 對應紀錄（用 `trade_no` 對 `provider_tx_id` 或加入新 `payment_intents.completed_at` 欄位）。
  - **Migration 建議**：`ALTER TABLE payment_intents ADD COLUMN completed_at timestamptz, status text DEFAULT 'pending'`，callback (ecpay/linepay/acpay/remittance) 成功時 UPDATE。一勞永逸取代 join。
- 對 `user_id` 非 null 者：
  - 有 LINE 綁定（`member_line_bindings` 該 expert）→ Flex Message「您的訂單還沒完成，點此繼續」
  - 否則 Email（同樣排除虛擬 email）
- CTA URL：依 `product_kind` 組 `/checkout?plan=…&utm_source=recovery&utm_campaign=abandoned`。
- Idempotency：`payment_intents.recovery_notified_at`（新欄位），同 intent 只發一次。

**2. UI：Account 頁面新增「未完成訂單」區塊**
- 顯示 `payment_intents` 7 天內 `status='pending'` 紀錄，含繼續付款按鈕、放棄按鈕（設 `status='abandoned'`）。

### 驗收
- 建立 intent 不付款 → 31 分鐘後收到提醒。
- 已成功付款的 intent 不會被誤判。
- 同 intent 不會重複提醒。

---

## W4-3｜失敗交易自動換管道回收

### 現況
- `payment_transactions.status='failed'` 後沒有自動 retry。
- `notify-payment-failure` 已存在但只寄通知，不導 alternative。

### 規格
**1. 強化 `notify-payment-failure`**
- 既有 email 內容追加「換個付款方式試試」三個按鈕：
  - ECPay（信用卡）
  - LinePay
  - 匯款（remittance）
- URL：`/{checkout-path}?plan={id}&method={ecpay|linepay|remittance}&utm_source=retry`
- Checkout 頁面接 `method` query param，預選對應付款方式。

**2. T+24h 二次召回 cron**
- 新增 `recover-failed-transactions` edge function，每日 10:00 (UTC+8)。
- 抓 `payment_transactions.status='failed' AND created_at > T-26h AND created_at < T-23h`，且該 user 該 plan 沒有後續成功交易。
- 同 W4-2 的 Line/Email 雙通道。
- Idempotency：audit_logs `action='payment.retry_reminder_sent'`。

### 驗收
- 故意失敗的 ECPay 交易，T+24h 收到含 LinePay 按鈕的 email。
- 已重新成功者不被召回。

---

## W4-4｜FreeCheckup Paywall 埋點 + A/B 文案

### 現況
- `conversions` 表只記成功訂單，缺 funnel 上游。
- FreeCheckup 6 tabs 撞牆點散落，無統一埋點。

### 規格
**1. 新增 `paywall_events` table**
```sql
CREATE TABLE public.paywall_events (
  id uuid PK default gen_random_uuid(),
  user_id uuid,            -- null 代表訪客
  visitor_id text,
  event_kind text NOT NULL,-- 'view' | 'hit_limit' | 'click_upgrade' | 'dismiss'
  surface text NOT NULL,   -- 'freecheckup_tab1' ... 'freecheckup_tab6' | 'pricing' | 'expert_profile'
  variant text,            -- A/B 文案版本：'control' | 'urgency' | 'value'
  context jsonb,           -- 額外資料（剩餘配額、撞牆原因）
  created_at timestamptz default now()
);
-- GRANT INSERT to anon, authenticated; SELECT 限 company_admin
```

**2. 前端埋點**
- `src/lib/paywall.ts`：`trackPaywall(event_kind, surface, ctx?)`，內部呼叫 `traffic-ingest` 或直接 insert。
- FreeCheckup 6 tab 各撞牆點呼叫 `hit_limit`。
- Paywall Modal 開啟呼叫 `view`，按鈕呼叫 `click_upgrade` / `dismiss`。

**3. A/B 文案系統**
- `variant` 由 `useMemo(() => visitorId.charCodeAt(0) % 2 === 0 ? 'urgency' : 'value', [])` 決定（簡易 50/50）。
- 文案集中於 `src/lib/paywallCopy.ts`：
  - `control`：「升級看完整 AI 解讀」
  - `urgency`：「您今日剩 X 次免費額度」
  - `value`：「已有 N 位用戶升級看完整分析」

**4. 後台儀表板 `/company/paywall-funnel`**
- 顯示：view → hit_limit → click_upgrade → 成功訂單（join `conversions`）漏斗，按 surface 與 variant 切片。
- 每日聚合 7/30 天。

**5. 撞牆 24h 折扣券（延後到 W4 完成後評估）**
- 暫不做，等資料蒐集 2 週再決定。本輪只埋觀測。

### 驗收
- 開 FreeCheckup → DB 有 `surface='freecheckup_tab{n}'` `event_kind='view'` 紀錄。
- 撞牆 → `hit_limit` 含 `context.remaining=0`。
- 後台儀表板能看到分 variant 漏斗。

---

## 共用：Migration 與排程清單

### Migrations 建議
```sql
-- 1. payment_intents 加狀態
ALTER TABLE payment_intents
  ADD COLUMN status text NOT NULL DEFAULT 'pending', -- pending|completed|abandoned
  ADD COLUMN completed_at timestamptz,
  ADD COLUMN recovery_notified_at timestamptz;

-- 2. notification_preferences 加 renewal_email
ALTER TABLE notification_preferences
  ADD COLUMN renewal_email boolean DEFAULT true;

-- 3. paywall_events 新表 + GRANT + RLS
```

### pg_cron 排程
| 任務 | 排程 (UTC) | UTC+8 | Edge Function |
|---|---|---|---|
| Email 續訂提醒 | `10 1 * * *` | 09:10 | email-push-renewal-reminder |
| Line 續訂提醒（既有，擴 T-0/T+1） | `0 1 * * *` | 09:00 | line-push-renewal-reminder |
| 棄單回收 | `*/30 * * * *` | every 30m | recover-abandoned-checkout |
| 失敗交易 T+24h | `0 2 * * *` | 10:00 | recover-failed-transactions |

### Callback 更新（W4-2 配套）
以下 callback 成功時必須 `UPDATE payment_intents SET status='completed', completed_at=now() WHERE trade_no=...`：
- `ecpay-callback`
- `checkup-ecpay-callback`
- `confirm-linepay`
- `acpay-notify`
- `confirm-remittance`

---

## 不在本輪範圍
- Referral 分潤閉環（P2，下輪）
- 訂閱頁信任訊號（P1，獨立 PR）
- 折扣券系統（等埋點資料）

---

## 實作順序建議
1. **Migration**（payment_intents 三欄、notification_preferences 一欄、paywall_events 一表）
2. **更新 5 個 callback** 標記 `status='completed'`
3. **W4-2 棄單回收**（基礎設施先行，馬上撿錢）
4. **W4-1 Email 續訂 + Line 擴 T-0/T+1 + Account banner**
5. **W4-3 失敗交易回收**（沿用 W4-2 模式）
6. **W4-4 Paywall 埋點 + 後台儀表板**

預估工程量：1 為 0.5d，2 為 0.5d，3 為 1d，4 為 2d，5 為 1d，6 為 2.5d。**合計約 7.5 工作天**。
