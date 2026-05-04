## 問題
點「綠界金流」付款後，預覽出現空白＋破圖。Edge Function 正常 200，問題出在前端 form 用 `target="_self"` 提交，預覽是 iframe，綠界回 `X-Frame-Options: DENY` 直接被瀏覽器擋下。

## 修正
`src/pages/CheckupCheckout.tsx` 第 139 行：將 ECPay 提交 form 的 target 從 `_self` 改為 `_top`，強制跳出 iframe 到頂層視窗導向綠界付款頁。

正式網域 (legendflow.tw) 不在 iframe 內，行為不變。

## 同步檢查
搜尋專案內所有 `form.target` 使用點（ECPay 相關 checkout 也可能有同問題）：
- `CheckupCheckout.tsx`（健檢）
- `Checkout.tsx` / 專家方案 checkout（若同樣 pattern 也一併改）

只動 `target` 字串，無其他邏輯變更。