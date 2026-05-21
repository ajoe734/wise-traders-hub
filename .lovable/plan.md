## 你回報的三個問題

1. **返回按鈕跑去持股看板**：`MyRemittanceOrders.tsx` L167 寫死 `<Link to="/free-checkup">`，無視使用者實際從哪裡來（專家方案結帳 → /account/remittance 的人本來就不該回健檢頁）。
2. **可不可以先離開、明天再付**：可以。匯款訂單建立後狀態 `awaiting_info`，後端排程 3 日內未補資料才會自動過期（`expire-stale-remittance`）。但目前頁面**完全沒寫**這件事，使用者不敢離開。
3. **離開後怎麼回來**：目前沒有任何選單入口。唯一機制是 `PendingRemittanceGuard`：登入後每個 session **只彈一次** toast 並強制 redirect，之後切走就找不到了。這設計確實有問題。

## 修改計畫

### 1. 修正返回按鈕（`MyRemittanceOrders.tsx`）
- 改用 `navigate(-1)`，並 fallback 到 `/account/profile`（會員中心）而非健檢頁。
- 返回字樣保留「返回」。

### 2. 加入「可離開」說明區塊（`MyRemittanceOrders.tsx`）
頁首副標下方加一張淡色提示卡：
- 「請於 **3 日內**完成銀行轉帳，並回到此頁補填末五碼與匯款人姓名。」
- 「您可以**先離開本頁**，稍後從『會員中心 → 我的匯款訂單』或登入後的提醒回來繼續。」
- 「逾期未補資料，訂單將自動關閉，請重新下單。」

### 3. 增加持久入口
讓使用者隨時找得到回來的路：

- **`Profile.tsx` Actions 區**：新增 `<Link to="/account/remittance">我的匯款訂單</Link>` 按鈕，若有 `awaiting_info` 訂單則加紅點 badge（用既有 `remittance_orders` 查詢，count only）。
- **`Subscriptions` 頁頂部**：若有 `awaiting_info` 訂單，顯示一條 banner「您有 N 筆匯款訂單待補資料 → 前往補填」。
- **`PendingRemittanceGuard.tsx`**：
  - 不再強制 `navigate(replace)`，改為**只顯示常駐 toast / 提醒**，使用者點擊才跳轉（避免把人從正在看的頁面拽走）。
  - 移除 `sessionStorage` 一次性鎖，改為「每次進入非 SKIP 路徑時若有未補訂單就提醒一次」並可手動關閉（記在 sessionStorage 以該訂單 id 為 key，避免每次切頁都跳）。

### 4. 文案微調（`Checkout.tsx` 成功 dialog）
建單成功後 dialog 已經把人導到 `/account/remittance`，但訊息要補上「您可隨時離開，3 日內回到『會員中心 → 我的匯款訂單』繼續即可」。

## 不會動到的範圍
- 後端 schema、edge function、3 日過期排程邏輯都不改。
- 表單驗證 / 冪等 / Realtime 都保留。
- 純前端 UI + 路由文案。

## 受影響檔案
- `src/pages/account/MyRemittanceOrders.tsx`（返回邏輯 + 說明卡）
- `src/pages/account/Profile.tsx`（新增入口 + badge）
- `src/pages/account/Subscriptions.tsx`（頂部 banner）
- `src/components/PendingRemittanceGuard.tsx`（改為非強制跳轉）
- `src/pages/Checkout.tsx`（成功訊息補一句）
