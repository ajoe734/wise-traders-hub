
## 背景

云云（user_id `adecfb23-275e-418b-8f92-5587af9a2a1a`）匯款了，但系統內 0 筆 `remittance_orders` / `payment_intents` / `member_subscriptions`，所以後台無單可審。

彥愷老師目前**只有「修煉派」一個方案**（月費 799，plan_id `ab1d8e55-290b-43a8-8cbb-b94dcc937200`），系統內並沒有「實戰派」這個 plan。研判云云記錯名稱，實際要訂的是修煉派。

## 執行內容

在 `remittance_orders` 補一筆 pending 訂單：

```
user_id          = adecfb23-275e-418b-8f92-5587af9a2a1a  (云云)
product_kind     = 'expert_plan'
plan_id          = ab1d8e55-290b-43a8-8cbb-b94dcc937200  (彥愷 / 修煉派)
billing_cycle    = 'monthly'
original_amount  = 799
discount_amount  = 0
amount           = 799
payer_name       = '云云'
last5            = '61338'
status           = 'pending'
```

完成後：
- 後台「匯款審核」會立刻出現這筆
- 你點「審核通過」→ 既有的 `confirm-remittance` 流程會自動建立 `member_subscriptions`（active，到期日 = 確認當下 +1 個月）並寄通知

## 風險與備案

- 若云云實際匯了不是 799（例如有折扣或匯錯金額），審核時請對帳；金額不符就在後台改 amount 或退件。
- 若她其實要訂的是別位老師的方案，先別審核通過，告訴我正確方案名我重建。
- 此操作不改 schema、不動 RLS，只插一列資料。
