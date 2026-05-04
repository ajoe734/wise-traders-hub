## 問題

目前 `/checkout/checkup/...` 選「銀行匯款」時，**還沒按確認就要使用者立刻填匯款人姓名 + 轉出帳號末五碼**。可是這兩個資訊只有「實際走進銀行/開 App 轉完帳之後」才會有，順序錯了。

## 正確流程

1. 使用者在結帳頁選「銀行匯款」→ 只看到收款帳號（銀行/戶名/帳號）和應付金額，按下「建立匯款訂單」。
2. 系統建立一筆 `remittance_orders`（狀態 `awaiting_info`），回傳訂單編號 + 收款資訊。
3. 使用者去銀行/網銀完成轉帳。
4. 使用者**之後**回到「我的匯款訂單」頁，找到該筆訂單，補填**匯款人姓名 + 末五碼**送出 → 訂單狀態變 `pending`。
5. 後台 (`confirm-remittance`) 維持只接受 `pending` 狀態的訂單做開通，行為不變。

## 變更內容

### 1. 資料庫 migration
- `remittance_orders.last5`、`payer_name` 改為 nullable。
- 既有資料保留；新訂單 status 預設值不變，但流程改用 `awaiting_info` → `pending` → `confirmed` 三段。

### 2. Edge Function
- `create-checkup-remittance`：移除 `last5` / `payerName` 必填；建立 row 時 status 寫 `awaiting_info`，`last5 = null`、`payer_name = null`；回傳 `orderId` + 收款帳號資訊。
- 新增 `submit-remittance-info`：
  - 驗證 JWT，僅允許訂單擁有者本人。
  - body: `{ orderId, last5, payerName }`，驗證 5 位數字、姓名非空。
  - 訂單須屬於該 user 且 status = `awaiting_info`，更新 `last5` / `payer_name` 並改 status = `pending`。
- `confirm-remittance` 不變（只接受 `pending`）。
- （可選一致性）`create-remittance`（專家方案）若同樣症狀就一起改；本次先以 checkup 為主，不動專家方案以縮小變更範圍。

### 3. 前端 `src/pages/CheckupCheckout.tsx`
- 選擇「銀行匯款」時：
  - 移除「匯款人姓名」與「末五碼」欄位。
  - 改顯示說明：「按下『建立匯款訂單』後，您會取得訂單編號，請於 3 日內完成轉帳，並回到『我的訂單 → 補填匯款資料』提交末五碼，後台對帳後即開通。」
  - 主要按鈕文字改成「建立匯款訂單」。
- 送出時呼叫 `create-checkup-remittance`（已不帶 last5/payerName），成功後顯示成功對話框：訂單編號、收款帳號、CTA「前往補填匯款資料」連到 `/account/remittance`。
- 「綠界金流」分支邏輯維持不變。

### 4. 新增會員端頁面 `/account/remittance`
- 列出當前登入者所有 `remittance_orders`（按 `created_at desc`）。
- 顯示訂單編號（短碼）、商品（健檢/專家方案）、金額、狀態徽章（`awaiting_info` 待補資料 / `pending` 待對帳 / `confirmed` 已開通 / `rejected`）。
- 對 `awaiting_info` 訂單提供 inline 表單：匯款人姓名 + 末五碼 → 呼叫 `submit-remittance-info`，成功後刷新清單。
- 路由註冊在 `src/App.tsx`，並在 `src/pages/account/Profile.tsx` 或主導覽加入入口連結。

### 5. RLS
- `remittance_orders` 應已有「user 可讀自己訂單」的 select policy；確認後增補「user 可 update 自己尚未確認的訂單之 `last5` / `payer_name`」的 policy（若不打算開放 client 直接 update，可改成 SECURITY DEFINER edge function 即可，這也是預設方案，因此不用動 RLS）。

### 6. 文案
- 結帳頁的匯款說明、成功 dialog、`/account/remittance` 頁面文字皆使用繁中且符合既有 Kore-eda 簡約風格。
- 日期格式維持 `YYYY/MM/DD`。

## 不需要做的事
- 不動 `confirm-remittance` 的後台對帳邏輯。
- 不動綠界金流流程。
- 不重做 schema，只加欄位 nullable。

確認後我會切到 build 模式依序執行：migration → edge function → 前端結帳頁 → 新增 `/account/remittance` 頁 → 補測試。