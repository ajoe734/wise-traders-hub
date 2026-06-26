## 目標
讓「視角檢視」與 target user 在 preview 看到的畫面完全一致；前端、後端、契約測試三層全部補齊。

## Phase 1 — 前端全面切換到 `useEffectiveUserId`

替換下列 15 處 `useAuth().user.id` → `useEffectiveUserId().userId`，並把 `isViewAs` 加進 react-query 的 `queryKey`：

| 檔案 | 改動 |
|---|---|
| `src/pages/app/Journals.tsx` | queryKey + fetcher 改用 effectiveUserId |
| `src/pages/app/Signals.tsx` | 同上 |
| `src/pages/app/SignalsDashboard.tsx` | 同上 |
| `src/pages/app/AppHome.tsx` | 訂閱卡片改 effectiveUserId |
| `src/pages/app/Explore.tsx` | 訂閱徽章改 effectiveUserId |
| `src/pages/account/Profile.tsx` | 讀 profile / line binding 走 effectiveUserId |
| `src/pages/_appAccount/LinePartySection.tsx` | 同上 |
| `src/pages/_appSubscriptions/FailedIntentsCard.tsx` | 同上 |
| `src/hooks/app/useAccountData.ts` | 同上 |
| `src/components/layouts/UnifiedAppLayout.tsx` | unread-signals / unread-journals |
| `src/components/NotificationBell.tsx` | 通知讀取 |
| `src/components/account/RenewalBanner.tsx` | 到期偵測 |
| `src/components/LineBindingCard.tsx` | 綁定狀態 |
| `src/hooks/useCrossProductDiscount.ts` | 跨產品折扣資格 |
| `src/components/PendingRemittanceGuard.tsx` | 匯款提醒 |

所有寫入路徑（mutations、analytics、payment、Line 綁定、refund 等）**保持** `useAuth().user.id` 並加上 `if (isViewAs) return` 守門（在 `ViewAsBanner` 上已有警示，再加一層程式碼防線）。

## Phase 2 — 後端 RLS 加 admin view-as 讀取權

目前的內容表 RLS 只信任 `auth.uid()`，admin 用自己 token 查別人會回 0 列。新增一個 helper 與 policy：

```sql
-- helper: 判斷 caller 是否對 target user 有效的 view-as session
CREATE OR REPLACE FUNCTION public.has_active_view_as(_target uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_view_as_sessions
    WHERE admin_user_id = auth.uid()
      AND target_user_id = _target
      AND consumed_at IS NOT NULL  -- 已 resolve
      AND revoked_at IS NULL
      AND expires_at > now()
      AND has_role(auth.uid(), 'company_admin')
  );
$$;
```

對下列表新增「admin in view-as session can read this user_id's rows」SELECT policy（只讀，不允許寫）：
- `member_subscriptions`
- `checkup_subscriptions`
- `expert_signals`（透過 plan_id → expert → 訂閱判斷）
- `notifications`
- `profiles`
- `member_line_bindings`
- `payment_transactions` / `payment_intents` / `remittance_orders`
- `user_performances`
- `trade_signals`

> 注意：`expert_signals` 訪問是由 `has_active_subscription_after()` 控制；要改成在 view-as 模式下用 target user 的訂閱判斷，新增 `has_active_subscription_after_for_target()` 或在原函數內加 OR 分支。

寫入仍鎖 `auth.uid() = user_id`，view-as 不放寬。

## Phase 3 — 契約測試

新增 `e2e/view-as-parity.spec.ts`：
1. 以 target user token 進 `/app`, `/app/signals`, `/app/journals`, `/app/account`, `/pricing`, `/expert/:slug`，擷取每頁的關鍵 DOM 文字（訂閱卡、到期日、訊號數、通知數、按鈕文案「立即訂閱 / 已訂閱」）。
2. 以 admin + view-as 開啟同樣路徑，截相同 DOM。
3. assertion：兩組 DOM 字串必須相等（排除 ViewAsBanner 本身）。
4. 若任何一頁不對等，CI 紅燈。

並補上 `e2e/view-as-write-guard.spec.ts`：在 view-as 模式下嘗試取消訂閱、發訊號、改 profile，期望 UI 阻擋 + 後端 RLS 拒絕。

## Phase 4 — 文件 + 記憶

- 更新 `docs/qa/subscription-funnel-e2e.md`：新增 View-as parity 章節。
- 新增 `mem://features/view-as/parity-architecture`：記錄「前端 effectiveUserId + 後端 view-as RLS helper + parity 測試」三層架構，避免下次又遺漏。

## 交付順序
1. Phase 2 migration（RLS 先放行，否則 Phase 1 改完仍是空資料）
2. Phase 1 程式替換（15 檔）
3. Phase 3 兩支 spec
4. Phase 4 文件 + memory

## 風險
- 加 RLS policy 後，admin 在「非 view-as」狀態下不會受影響（policy 依賴 `has_active_view_as`，無 session 則回 false）。
- 已 resolve 的 session 仍允許多次讀取（only consumed_at 為時間戳記，不立即失效）— 維持原設計，admin 切換 target 時前端會 issue 新 token。
- 若 user 接受，全部變更會在同一輪完成。
