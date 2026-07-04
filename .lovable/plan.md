# 修正 AppCheckout 付款方式沒顯示匯款

## 根因
`src/pages/app/AppCheckout.tsx` 前一輪雖然改成從 `payment_providers` 動態撈，但有兩個 bug 讓修改完全沒生效：

1. **Query 用了不存在的欄位**：`.order("sort_order")` — `payment_providers` 表根本沒有 `sort_order` 欄位，query 直接報錯，`providers` 永遠是 `[]`。
2. **Fallback 寫死回舊清單**：L416–418 當 `providers.length === 0` 時 fallback 到 `[meta.line_pay, meta.ecpay]`，把 DB 真實設定完全蓋掉。

DB 目前 active 的 provider 是 `remittance` + `ecpay`（`line_pay` / `acpay` 都 `is_active=false`），正確畫面應該是「銀行匯款 + 綠界 ECPay」兩張卡，而不是截圖那樣的 LINE Pay + ECPay。

## 修改

### `src/pages/app/AppCheckout.tsx`
1. 拿掉 `.order("sort_order", ...)`，改用 `.order("display_name")` 或直接不排序（display_name 是 DB 實際存在欄位）。
2. 把 L416–418 的 `providers.length > 0 ? … : [meta.line_pay, meta.ecpay]` fallback 拿掉，直接 `providers.map(p => meta[p.provider_type]).filter(Boolean)`。
3. 保底：如果最後 `cards.length === 0`（DB 全空或全關），顯示一段「目前沒有可用的付款方式，請聯繫客服」訊息，而不是硬塞 LINE Pay/ECPay 進去。
4. `paymentMethod` 初始化 — 目前預設 `line_pay`，但 line_pay 已停用會導致按鈕按下去 404。改成：從撈回來的 providers 選第一個 active 的當預設（若 URL 有帶 `?method=` 且該 method 也 active，優先用 URL）。

### E2E
`e2e/checkout-full-flow.spec.ts` 已有 remittance mock（case A），但它走的是舊 `/checkout/...` 路徑不是 `/app/checkout/...`。補一個 case 進 `/app/checkout/:slug/:planId` 且 mock `payment_providers` 回 `[remittance, ecpay]`，斷言看得到「銀行匯款」卡片、看不到 LINE Pay 卡片。

## 驗證
1. `tsgo` 通過。
2. Playwright 開 `/app/checkout/sharkgu/ab1d8e55-...?cycle=monthly`，截圖確認出現「銀行匯款」+「綠界 ECPay」兩張卡，沒有 LINE Pay。
3. 點匯款 → 按鈕文字變「建立匯款訂單」→ 顯示 `RemittanceAccountCard`。
