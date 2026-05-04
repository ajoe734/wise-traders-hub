完整審計後，匯款對帳鏈路（建立 → 補填 → 後台確認 → 入帳/分潤）有 5 個問題，第 1 點會讓使用者完全無法選擇「匯款」付款。

## 一、CRITICAL：`remittance_orders.status` CHECK 沒有 `awaiting_info`

資料庫實際 constraint：

```
CHECK (status IN ('pending','confirmed','rejected','expired'))
```

但程式碼已經改成新流程：
- `create-checkup-remittance` insert `status: 'awaiting_info'`
- `submit-remittance-info` 從 `awaiting_info` → `pending`
- `MyRemittanceOrders` / `PendingRemittanceGuard` 都假設此狀態存在

→ **目前選「匯款」會直接 500（constraint violation），整條流程是斷的。** 必須補一支 migration 把 `awaiting_info` 加入 CHECK。

## 二、CRITICAL：`payment_providers.provider_type` enum 沒有 `remittance`

`confirm-remittance` 跑：
```ts
.from("payment_providers").eq("provider_type", "remittance")
```
但 enum 只有 `ecpay / newebpay / stripe / line_pay / acpay`。所以 `provider_id` 永遠是 `null`，分潤雖然還是寫得進 `revenue_splits`（因為 fallback 走 attribution/checkup default），但 `payment_transactions.provider_id` 留空 → Revenue 報表「來源拆分」要靠特判才認得出匯款（目前 Revenue.tsx 是另外掃 `remittance_orders` 才補上「匯款」桶，勉強可用，但不乾淨）。

→ migration 把 `'remittance'` 加進 `provider_type` enum，並補一筆 `payment_providers` 啟用列。

## 三、`create-checkup-remittance` 把客戶端傳的折扣/歸因吞了

`CheckupCheckout` 已經算好 `originalAmount / discountAmount / discountReason / attribution` 並送到 edge function，但 function 完全沒讀，硬寫 `original_amount = amount, discount_amount = 0, attribution = null`。

→ 結果：跨產品優惠（健檢↔專家方案）走匯款時收費正確、但帳上看不到折抵金額，分潤也少一塊歸因。需要修 function 真正接收這幾欄。

## 四、後台「匯款審核」缺 `awaiting_info` / `expired` 篩選

`src/pages/company/Remittance.tsx` 的 filter 只給 `pending / confirmed / rejected / all`。
新流程下，使用者在「補填中」階段就建單了，admin 看不到「有多少訂單在 awaiting_info 卡住」。

→ Filter 加 `awaiting_info`（待補資料）與 `expired`（已過期）兩種；卡片狀態 Badge 顯示文案也對齊 `MyRemittanceOrders` 的 STATUS_META（待補/待對帳/已開通/已拒絕/已過期）。

## 五、無自動過期機制

DB 有 `expired` 狀態，CheckupCheckout 文案說「請於 3 日內完成銀行轉帳」，但沒有 cron 把超過 N 天還沒進到 `pending` 的訂單轉成 `expired`。久了「我的匯款訂單」會堆很多殭屍 awaiting_info，`PendingRemittanceGuard` 也會一直把使用者抓回去煩。

→ 加一支簡單 edge function `expire-stale-remittance`：把 `awaiting_info` 超過 3 天 / `pending` 超過 14 天的 orders 標 `expired`，並用 `pg_cron` 每天台灣時間 09:00 執行（在交易時段內）。

---

## 改動清單

```text
DB migration（必要）
  └─ 1. ALTER CHECK remittance_orders.status: 加 'awaiting_info'
  └─ 2. ALTER TYPE provider_type ADD VALUE 'remittance'
  └─ 3. INSERT payment_providers (provider_type='remittance', is_active=true)
  └─ 4. cron: 每日 01:00 UTC 執行 expire-stale-remittance

Edge functions
  └─ supabase/functions/create-checkup-remittance/index.ts
       讀取並寫入 originalAmount / discountAmount / discountReason / attribution
  └─ supabase/functions/expire-stale-remittance/index.ts （新增）
       awaiting_info > 3d → expired；pending > 14d → expired

UI
  └─ src/pages/company/Remittance.tsx
       Filter 加 awaiting_info / expired；Badge 文案對齊 STATUS_META
```

## QA

1. 健檢結帳選「匯款」→ 回到 `/account/remittance` 看到 awaiting_info 卡片。
2. 補填末五碼+姓名 → 變成 pending；admin 後台看到。
3. Admin 確認 → `checkup_subscriptions` 啟用、`payment_transactions`+`revenue_splits` 寫入、`remittance_orders.status='confirmed'`。
4. Admin 拒絕 → 使用者端看到拒絕原因。
5. 跨產品折扣訂單走匯款 → `remittance_orders.discount_amount`/`discount_reason` 正確；`revenue_splits.discount` 正確。
6. 手動把一筆 awaiting_info 的 created_at 設為 4 天前 → 跑一次 cron → 變 expired。
