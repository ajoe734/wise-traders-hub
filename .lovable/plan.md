## 目標
後台目前只能送 LINE 群發，缺少「站內通知」（會員登入後點鈴鐺看到的 `暫無通知` 那個位置）。新增管理員可對**單一會員**或**多位勾選會員**寫入站內通知的入口，直接 insert `public.notifications`，不走 LINE。

## 使用者流程
1. 進入 `/company/subscribers`。
2. **單人**：每一列操作區新增「站內通知」按鈕；不管是否綁定 Line 都可用（站內通知用 `user_id` 就能送）。
3. **多人**：頁首原本「Line 推播」按鈕旁多一顆「站內通知 (N)」按鈕，disabled 條件 = 未勾任何人。
4. 點擊後開啟新 dialog `PlatformNotifyDialog`：
   - 顯示收件人數與名字預覽（>3 折疊）。
   - 欄位：`標題`（必填，≤80 字）、`內容`（選填，≤500 字）、`類型`（info / success / warning，決定鈴鐺 icon 顏色）、`連結 URL`（選填，會員點通知後導向）。
   - 送出 → 對每個 `user_id` `supabase.from('notifications').insert({ user_id, title, body, type, link })`（單次 `insert([...])` 批次）。
   - 成功 toast「已送出 N 則通知」，關閉並清空勾選。
5. 會員端無需改動：`NotificationBell` 與 `/account/notifications` 已經在讀 `notifications` 表，插入後即出現。

## 技術範圍（純前端 + 既有 RLS，無 migration / edge function）
- 新增 `src/components/company/PlatformNotifyDialog.tsx`
  - Props：`open, onOpenChange, recipients: { user_id; display_name? }[], onSent?()`
  - Insert 使用 `.insert(rows).select()`；失敗顯示 error message。
- 修改 `src/pages/company/Subscribers.tsx`
  - state：`platformOpen`（批次）、`platformTarget`（單人 or null）。
  - 頁首加「站內通知 ({selectedUserIds.size})」按鈕。
  - 每列操作區加「站內通知」小按鈕（icon: `Bell`）。
  - 掛兩個 `<PlatformNotifyDialog>`（批次一個、單人一個）。
- 不動：LinePushDialog、`admin-line-push` edge function、`notifications` schema/RLS（既有 `Company admins full access` policy 已允許 admin insert）。

## 驗收
- 對自己（admin 本人）發一則 → 立刻在 `NotificationBell` dropdown 與 `/account/notifications` 看到。
- 對未綁 Line 的會員發一則 → 該會員登入後看得到（LINE 群發做不到的情境）。
- 批次選 3 人送 → 三人各自收到一則、`is_read=false`。
- 標題空白時送出按鈕 disabled。
- 有填 `link` 時，會員在鈴鐺點通知會導向該連結（沿用 NotificationBell 既有行為）。
