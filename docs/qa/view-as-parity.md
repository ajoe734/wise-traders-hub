# View-as 視角檢視 — 一致性 (parity) 規範

## 目的
admin 啟用「視角檢視」後，前端所見的資料必須與被模擬會員自行登入所見**一致**，且 admin 不得以視角寫入會員資料。

## 一律使用 `useEffectiveUserId()`
- 任何讀取「目前使用者」資料的 hook / component，禁止直接用 `useAuth().user.id`。
- 改用 `const { userId: effectiveUserId, isViewAs } = useEffectiveUserId()`。
- TanStack Query 的 `queryKey` 必須包含 `effectiveUserId` 與 `isViewAs`，以避免 admin 與被模擬會員的快取互相污染。

### 已導入清單（Phase 1 完成）
- `src/pages/app/Journals.tsx`、`Signals.tsx`、`SignalsDashboard.tsx`
- `src/pages/app/AppHome.tsx`（greeting）
- `src/pages/account/Profile.tsx`
- `src/pages/_appSubscriptions/FailedIntentsCard.tsx`
- `src/hooks/app/useAccountData.ts`
- `src/hooks/useCrossProductDiscount.ts`
- `src/components/layouts/UnifiedAppLayout.tsx`（unread-signals / unread-journals）
- `src/components/NotificationBell.tsx`
- `src/components/account/RenewalBanner.tsx`
- `src/components/LineBindingCard.tsx`
- `src/components/PendingRemittanceGuard.tsx`

## tester / draft 過濾
- `isTester` 旗標只屬於登入 admin，**view-as 時必須強制視為 false**，否則 admin 會看到一般會員看不到的 draft 內容。
  - 例：`const isTester = isViewAs ? false : (user?.isTester ?? false);`

## 寫入守門 (write-guard)
view-as 模式下禁止以被模擬會員身分寫入任何資料，前端先擋一層：
- `useAccountData.handleCancelSubscription`：`isViewAs` 時 toast 拒絕。
- `NotificationBell.markAllRead` / 點擊 notification 的 mark-read：`isViewAs` 跳過 PATCH。
- `LineBindingCard.generateCode` / `handleUnbind`：`isViewAs` 時 toast 拒絕。

> 後端仍應靠 `admin-view-as` 的 audit log 與 RLS 把關，前端守門只是 UX 防呆。

## E2E 守護
- `e2e/view-as-content-access.spec.ts` (F4)：訂閱狀態跟著被模擬會員切換。
- `e2e/view-as-parity.spec.ts` (F4b)：notifications 讀 target、view-as 不發 PATCH。

兩支 spec 都在 `playwright.config.ts` 內以獨立 project 註冊（`desktop-view-as-content-access` / `desktop-view-as-parity`），PR 預設會跑。

## 新增頁面 / hook 的檢查清單
1. [ ] 讀「目前使用者」改用 `useEffectiveUserId()`。
2. [ ] `queryKey` 帶 `effectiveUserId`、`isViewAs`。
3. [ ] 若有寫入動作，`isViewAs` 時阻擋並提示。
4. [ ] 若涉及 tester / draft 篩選，view-as 強制 false。
5. [ ] 補 e2e 或單元測試確保 view-as 行為。
