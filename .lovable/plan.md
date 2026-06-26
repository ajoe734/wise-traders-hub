## 問題
視角預覽列已正確顯示 `edwillam1007@gmail.com` 為 member、**無有效訂閱**，但 `/app/expert/:slug` 的方案卡仍顯示「已訂閱」。

## 根因
`src/pages/app/ExpertDetail.tsx` L86–101 的 `fetchSubscription` 直接呼叫 `supabase.auth.getUser()` → 拿到的是**管理員自己**的 user id，再去查 `member_subscriptions`。管理員本身訂了彥楷的「修煉派」，所以即使視角是別人也仍亮燈。

`useMemberSubscriptions` 已正確走 `useEffectiveUserId`，但這支頁面沒用它，而是維護一份自己的 local state。

## 修法（最小變更）

1. **`src/pages/app/ExpertDetail.tsx`**
   - 移除 `subscribedPlanTypes` useState + `useEffect`。
   - 改用既有的 `useMemberSubscriptions()` hook（已 view-as 感知）。
   - 由回傳 rows 中 `expert.slug === slug && plan_type === ...` 推導：
     - `isSubscribedToFollower`：`analyst_signal_l1` / `analyst_signal_diag_l2`
     - `hasHealthCheck`：`analyst_signal_diag_l2`
     - `isSubscribedToCultivator`：`mentor_weekly_journal`
   - 保留 `previewMatch`（分析師自我預覽）OR 邏輯不變。
   - hook 順序不變（仍在 early return 之前）。

2. **驗證**
   - 視角預覽 `edwillam1007@gmail.com` 進入 `/app/expert/<彥楷 slug>`：兩處「已訂閱」徽章與底部按鈕應改為顯示「訂閱方案」CTA。
   - 退出視角後，管理員本人若實際有訂閱，仍應顯示「已訂閱」。
   - 既有 e2e `e2e/app-expert-detail.spec.ts` 跑過。
   - 新增 1 個 e2e case：模擬 view-as session（sessionStorage 注入 `view-as-session-v1` 指向無訂閱 user）→ 斷言「訂閱方案」可見、「已訂閱」不可見。

## 不在此範圍
- `Signals.tsx` / `Journals.tsx` / `Explore.tsx` / `AppCheckout.tsx` 已盤點過，沒有再次直接呼叫 `auth.getUser()` 做訂閱判定（AppCheckout L35 已是註解說明已合併）。本回合只修 ExpertDetail，其他頁如果之後也發現有同樣 bug 再另開單。
