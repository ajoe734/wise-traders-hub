

# LINE 綁定加入訂閱狀態檢查

## 目標
未訂閱該分析師的用戶，在 LINE 綁定欄位顯示「尚未訂閱」，無法取得驗證碼。只有付費訂閱後才能進行綁定。

## 變更內容

### 1. LineBindingCard 元件新增 `isSubscribed` 屬性
- 新增 `isSubscribed?: boolean` prop（預設 `true` 以向下相容）
- 當 `isSubscribed === false` 時，顯示「尚未訂閱」狀態卡片，隱藏「取得驗證碼」按鈕，改為引導用戶前往訂閱頁面

### 2. Account 頁面傳入訂閱狀態
- 目前 `advisors` 列表混合了真實訂閱的專家與 mock 專家
- 為每位專家標記 `isSubscribed` 屬性：真實訂閱的為 `true`，mock 的為 `false`
- 將此屬性傳入 `LineBindingCard`

### 3. LINE mini-app 帳號頁面同步處理
- `src/pages/line/Account.tsx` 中如果有 LINE 綁定相關元件，也需加入相同的訂閱檢查邏輯

## 未訂閱狀態 UI
- 顯示專家頭像、名稱（維持現有佈局）
- 「取得驗證碼」按鈕替換為灰色「尚未訂閱」文字
- 下方提供「前往訂閱」連結，導向該專家的方案頁面

## 技術細節
- **修改檔案**：`src/components/LineBindingCard.tsx`、`src/pages/app/Account.tsx`
- 不需要資料庫或 RLS 變更，訂閱檢查已在前端透過 `has_active_subscription` RPC 完成
