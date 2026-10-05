# 新會員訂閱前：先引導加入官方 LINE（@621opcej）

## 目標
任何會員按下「訂閱／前往結帳」時，先跳出「加入官方 LINE」視窗，加入後才進入結帳。之後到期提醒、開通通知就能透過官方 LINE 送到會員手上。

## 使用者看到的流程
```text
方案頁 / 老師頁 按「訂閱」
   -> 跳出視窗：「先加入 legendflow 官方 LINE，才收得到開通與到期通知」
        [加入好友按鈕（手機開 LINE App）]  [QR Code（電腦掃描）]
        [我已加入，繼續結帳]
   -> 進入原本的結帳頁（年繳／月繳、匯款、刷卡都不變）
```
- 涵蓋所有訂閱入口：老師方案訂閱（Checkout）與健檢方案訂閱（CheckupCheckout），以及續訂連結。
- 已確認加入過的會員不會再跳（記在帳號上，換裝置也有效）。
- LINE 登入會員：系統用官方帳號即時查是否已是好友；已是好友直接放行，不跳視窗。
- Email 會員：無法由系統查好友關係，以按「我已加入」為準。
- 視窗保留小字「稍後再加」，不會因此擋住付款（避免掉單）；但會在帳號頁持續提示直到加入。

## 技術細節
- 新元件 `JoinOfficialLineGate`（Dialog）：加好友網址 `https://line.me/R/ti/p/@621opcej`、QR 圖、確認按鈕；文案與網址集中在單一常數檔。
- 在結帳頁進入時（Checkout.tsx、CheckupCheckout.tsx）先渲染 Gate，確認後才顯示結帳內容；送出付款的程式不改。
- 新 Edge Function `line-friend-status`（已登入才可呼叫）：讀呼叫者 `profiles.line_user_id`，用 `PLATFORM_LINE_CHANNEL_TOKEN` 打 LINE `/v2/bot/profile/{uid}`，回傳 `{ isFriend }`；token 不出現在前端。
- 確認狀態寫入：profiles 新增可空欄位 `official_line_acked_at`（migration，只加欄位，沿用既有 profiles 自己可改自己的權限，不動其他 RLS）。
- 帳號頁加一張「加入官方 LINE」提示卡，未確認者顯示。
- 埋點：`line_gate_shown` / `line_gate_join_click` / `line_gate_confirm` / `line_gate_skip`，沿用既有 track()。
- 測試：Gate 單元測試（已確認不跳、LINE 好友直接放行、略過仍可結帳），e2e 結帳流程補一步點擊確認；跑既有結帳相關測試確保不掉單。
- 不在此計畫內：改寫到期提醒改走官方 LINE 推播（另案）；正式網站需發布才生效。
