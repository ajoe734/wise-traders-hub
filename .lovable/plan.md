# 匯款選項在新版 /app/checkout 消失 — 補回

## 問題根因

舊版 `src/pages/Checkout.tsx` 是從 `payment_providers` 資料表動態撈啟用中的通道（`line_pay` / `ecpay` / `remittance` / `acpay`），所以匯款會出現。

新版 `src/pages/app/AppCheckout.tsx`（`/app/checkout/:slug/:planId`）為了簡化，把付款方式**硬編碼**成只有 LINE Pay 和 ECPay 兩張卡（見 `AppCheckout.tsx` L362–369）。當先前把「立即續訂」和 legacy 網址全部改導向 AppCheckout 後，匯款這條路徑就整個消失了。

CheckupCheckout（健檢）不受影響，還保留匯款。

## 修改範圍（只動前端呈現，不動金流邏輯）

### 1. `src/pages/app/AppCheckout.tsx`
- 從 `payment_providers` 撈啟用中的 provider（`is_active = true`），依 `sort_order` 排序，動態渲染付款方式卡片，取代目前寫死的兩張卡。
- 卡片標籤沿用現有文案：`line_pay → LINE Pay`、`ecpay → 綠界 ECPay / 信用卡`、`remittance → 銀行匯款`、`acpay → ACpay`（ACpay 已停用，若 DB 有資料才顯示）。
- 送單分支新增 `remittance`：
  - 呼叫既有 `create-remittance-order` edge function（沿用 `Checkout.tsx` 的 `dispatchRemittance` 流程），建立 `remittance_orders`（`awaiting_info`），成功後導向 `/app/account/remittance`（若該路由不存在則沿用 `/account/remittance`，待確認）。
  - 顯示 `RemittanceAccountCard`（`src/pages/_remittance/RemittanceAccountCard.tsx`）在 provider 選為匯款時，與 ECPay/LINE Pay 表單同層。
  - 底部主按鈕文字改為「建立匯款訂單」。
- 追蹤事件 `checkout_payment_method_select` / `checkout_submit` 帶上 `method: 'remittance'`，與舊版一致。

### 2. E2E 補測（`e2e/checkout-full-flow.spec.ts` 或新檔）
- Mock `payment_providers` 回三筆（含 remittance）→ 進入 `/app/checkout/:slug/:planId` → 斷言看得到「銀行匯款」卡片。
- 點選匯款 → 主按鈕變「建立匯款訂單」，且顯示 `RemittanceAccountCard`。

### 3. 不動的東西
- `create-remittance-order` / `remittance_orders` schema / 對帳流程 — 沿用。
- CheckupCheckout — 沒壞、不動。
- 舊 `Checkout.tsx` — 保留但已無入口，本次不刪。

## 驗證
1. Playwright 開 `/app/checkout/:slug/:planId`，截圖確認三種付款方式都出現。
2. 選匯款 → 送出 → 確認導頁到 `/account/remittance` 並看到新訂單。
3. 續訂路徑（`RenewalBanner` / `SubscriptionCard` / legacy URL）進來也能選匯款。
