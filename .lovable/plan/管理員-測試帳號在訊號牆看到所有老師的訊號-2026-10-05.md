# 管理員/測試帳號在訊號牆看到所有老師的訊號

## 根因（已查證）
- qw2811569@gmail.com 是 company_admin + tester。資料庫 RLS 沒擋：`expert_signals` 有「Company admins full access signals」政策，管理員可讀全部訊號。
- 擋在前端 `src/lib/subscriptionVisibility.ts` 的 `fetchSubscriberSignals`：
  1. 沒有有效訂閱 → 直接回 `hasSubscription: false`，頁面顯示「您尚未訂閱任何分析師」。
  2. tester 模式把專家過濾成 `status = 'draft'`（目前 draft 老師 0 位）。
  3. 只取 `role = 'advisor'`，mentor 的訊號不在此牆。
- 訊號詳情頁（`/app/signal/:id`）對 company_admin 已走 owner fallback，不受影響。
- 週記牆 `src/pages/app/Journals.tsx` 有同樣的「無訂閱即空 + tester 只看 draft」邏輯。

## 修正
1. `fetchSubscriberSignals` 新增 tester/管理員分支：當 `isTester` 為 true（view-as 時已強制 false，不受影響）：
   - 跳過訂閱查詢，直接取所有 `status = 'active'` 專家（advisor + mentor 皆含）的 `published` 訊號，`hasSubscription` 回 true。
   - 一般會員與 view-as 路徑完全不變。
2. `src/pages/app/Journals.tsx` 的 `fetchJournalsData` 同步加 tester 分支：無訂閱也能列出所有 active 導師的週記（tester 診斷區塊標示「測試者：顯示全部老師」）。
3. 測試：
   - 更新 `src/test/integration/1.8-subscription-content-visibility.test.ts`：tester 無訂閱可見全部 active 老師訊號；一般會員行為不變。
   - 跑 tsgo + 相關 Vitest。
4. 驗證：Preview 登入 qw2811569@gmail.com 開 `/app/signals` 與 `/app/journals`，確認列出所有老師內容、點詳情可開。

## 不動
- 不改資料庫、RLS、權限；不發布正式網站。
- 一般會員的訂閱門檻與 T+7 規則維持原樣。
