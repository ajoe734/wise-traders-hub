## 問題（更正版）

實測三個頁面：

| 頁面 | 路由 | 顯示收款帳號？ |
|---|---|---|
| `Checkout.tsx`（專家方案結帳） | `/checkout/:slug/:planId` | ❌ 完全沒有 |
| `CheckupCheckout.tsx`（健檢結帳） | `/checkout/checkup/:planId` | ✅ 有撈 `payment_settings_safe` |
| `MyRemittanceOrders.tsx`（補末五碼頁） | `/account/remittance` | ❌ 完全沒有 |

使用者截圖那筆是「專家方案 月繳 NT$599」走 `Checkout.tsx`，建立完 awaiting_info 訂單直接導去 `/account/remittance`，**整段流程從頭到尾沒出現銀行帳號**，所以才會幹譙。

收款帳號資料源已存在 `payment_settings_safe` 表 key=`remittance_account`（`CheckupCheckout` 用的同一份）。

## 方案

### 1. 抽共用元件 `src/pages/_remittance/RemittanceAccountCard.tsx`（新增）

避免在三處重複維護同樣 UI / 取數邏輯。

- 內部 React Query：`['remittance-account-info']`，`staleTime: 5 min`
- 從 `payment_settings_safe`（`key='remittance_account'`）撈 `{ bank_name, bank_code, account_number, account_name }`，沿用 checkup 的欄位 fallback (`bank/branch/account/name`)
- props：`{ amount?: number; orderId?: string; className?: string }`
- UI（kore-eda minimal、無陰影漸層、字級 ≤ 22px）：
  ```
  收款帳號
  ─────────────────
  銀行   玉山銀行（808）
  戶名   ◯◯◯
  帳號   1234567890123456   [複製]
  金額   NT$ 599            [複製]    ← amount 有給才顯示
  ```
- 帳號 / 金額右側 `Copy` icon → `navigator.clipboard.writeText` + toast「已複製」
- 金額複製時去掉 `NT$ ` 與千分位，只複製純數字
- 未設定時顯示「收款帳號尚未設定，請聯絡客服」

### 2. `src/pages/Checkout.tsx` — 加上元件

- 找到付款方式選到匯款／其他 manual provider 時的條件區塊（與 ecpay 並列那段），插入 `<RemittanceAccountCard amount={price} />`
- 同時把現有「建立匯款訂單後請於 3 日內完成轉帳」的提示文字保留，但金額由元件提供
- 不傳 `orderId`（此時還沒建單）

### 3. `src/pages/CheckupCheckout.tsx` — 換成共用元件

- 刪掉 L32 `bank` state、L38-49 的 `useEffect` 抓取邏輯、L256-265 inline UI
- 改成 `<RemittanceAccountCard amount={price} />`
- 流程說明文字（L268-272）保留

### 4. `src/pages/account/MyRemittanceOrders.tsx` — 每張未付款訂單卡片加入元件

- 在 `status === 'awaiting_info' || status === 'pending'` 的訂單卡裡，補末五碼表單**上方**插入 `<RemittanceAccountCard amount={o.amount} orderId={o.id.slice(0,8)} />`
- 已 confirmed / rejected / expired 的不顯示

### 5. 頂部說明微調 `MyRemittanceOrders.tsx`

把現有「請於 3 日內完成銀行轉帳」那段加一句：「下方每筆訂單會列出收款帳號與應匯金額。」

## 不改

- 不改 schema、不改任何 edge function
- 不改 `Checkout.tsx` 的 ecpay/acpay 分支
- 不改 `StatusStepper`、不動 `AppCheckout.tsx`（沒有匯款選項）
- 不動 `PendingRemittanceGuard`、`Account.tsx`、`Profile.tsx` 等列表入口

## 技術細節

- `payment_settings_safe` 在 `types.ts` 沒涵蓋 → 沿用既有 `(supabase.from as any)` 寫法
- 元件放在 `src/pages/_remittance/`（已有 `StatusStepper.tsx` 同樣模式）
- React Query cache key 全站共用 `['remittance-account-info']`，三個頁面只會發一次請求
