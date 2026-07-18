
## 現況（已查證）

- 路由 `/app/journal/:id` → `src/pages/app/JournalDetail.tsx`。
- `fetchJournalBundle` 直接 `supabase.from('expert_signals').select(...).eq('id', id).single()`；一旦回 null 就 render `<UnavailableContent />`。
- 老周（`user_id=1d2c9c82…`）確實是 `experts.id=890db218…` 的 owner，`expert_signals` 的 RLS「Analysts can view own signals」在其自身 auth 下必定放行（已用 SQL 驗證 `is_owner=true`）。
- 但 `JournalDetail` **完全沒感知 `usePreviewMode()`**：
  - `Journals.tsx` 列表用 `previewExpertId` 硬塞老周自己的 id 進去撈清單，所以看得到卡片。
  - 列表連結 `to={/app/journal/${id}}` 沒帶任何 preview 參數。
  - `JournalDetail` 的 `isPreview` 只認 `?preview=1` query param（列表沒送），也沒用來影響 fetch。
- 現場症狀：banner 顯示「以老周老周訂閱者身分檢視」→ 點進週記卡 → UnavailableContent。因為連結沒帶 preview 且沒有診斷，一律吃悶虧，實際失敗原因（RLS 拒絕、`.single()` 錯誤、session 過期、身份不匹配）完全被吞掉。
- 未查證的根因：`.single()` 為何回 null。可能是 (a) 老周此刻的 Supabase session 過期或 uid 不匹配、(b) 走了非 owner 身份、(c) 其他 client 端錯誤被吞掉。要先讓失敗原因顯形，再對症處理。

## 目標

1. Mentor 開啟預覽模式，點自己任何一篇週記，都能像訂閱者一樣看到內容，不再 404。
2. 若 fetch 真的失敗，UI 要說出原因（RLS / not signed in / not owner / network），而不是一律 UnavailableContent。
3. 不變更會員／訂閱權限邏輯，僅在「當前使用者是該篇 signal 的 expert owner」時放行。

## 實作步驟

### 1. 建立 SECURITY DEFINER RPC `get_owned_journal_bundle(signal_id)`

`supabase/migrations/*_get_owned_journal_bundle.sql`：

- 參數：`_signal_id uuid`
- 邏輯：撈 `expert_signals`+`experts` 內嵌欄位。
- 授權：`SECURITY DEFINER`，內部斷言 `EXISTS (SELECT 1 FROM experts WHERE id = signal.expert_id AND user_id = auth.uid())`，不成立就 `RAISE EXCEPTION 'not_owner'`；成立則回同週（Mon–Fri）該 expert 全部 `published` signals。
- `GRANT EXECUTE ON FUNCTION ... TO authenticated;`
- 不動任何既有 RLS/policy。

### 2. `src/hooks/usePreviewMode.ts`

無需改；`isPreview` 已可判斷「當前使用者是該 expert owner 或 company_admin」。

### 3. `src/pages/app/JournalDetail.tsx`

- 引入 `usePreviewMode()`，把 `isPreview`（sessionStorage 版）與現有 `?preview=1` 邏輯合併。
- 改寫 `fetchJournalBundle(signalId, { forceOwner })`：
  - 先跑目前的公開查詢。
  - 若 `error || !data`，且 `forceOwner === true`，改呼叫 `supabase.rpc('get_owned_journal_bundle', { _signal_id })`。
  - 兩條路徑都拿不到 → return `{ signal: null, error: '<具體原因字串>' }`。
- `useQuery.queryKey` 加上 `isPreview` 以強制在切換時重取。
- `if (!signal)` 分支改為：
  - 顯示 UnavailableContent，`kind` 保持 `journal`。
  - Dev / mentor 預覽模式下另外印 `error` 文字，方便老周截圖回報。

### 4. `src/pages/app/Journals.tsx`

- 週記卡片 `<Link>`：若 `previewExpertId` 存在，`to={/app/journal/${id}?preview=1}`；否則保持原樣。
- 讓 detail 頁在無 sessionStorage（例如新分頁）時仍能認出預覽情境。

### 5. 診斷 & 驗證

- 手動：以老周帳號登入 → 進 `/admin/master-zhou` → 開預覽 → `/app/journals` → 點任一篇 → 應直接看到內容。
- 手動：以非 owner 帳號打 `/app/journal/{id}?preview=1` → RPC `not_owner` → 仍顯示 UnavailableContent（不越權）。
- 補一支 Playwright（`e2e/mentor-journal-preview.spec.ts`）：注入 mentor session、開預覽、進列表→詳情，斷言 `text=無法顯示` 不出現且能看到 `reason_summary` 文字。

## 技術細節

- **為何用 RPC 而不是新增 RLS policy**：現有 policy「Analysts can view own signals」理論上已足夠；若還是 fail，代表 client-side auth session 或 policy 邊界有隱性斷點。RPC + SECURITY DEFINER 是最短、最能保證「owner 一定看得到」的路徑，同時明確 raise error 讓 UI 有東西可顯示。
- **不改 `Journals.tsx` 的 subscription 判斷**：只在 URL 上加 `?preview=1`。
- **不動 ViewAsContext / admin-view-as**：本次議題是 mentor 自我預覽，不是 admin 代看。
- **RPC 內部避免 `RAISE`**：改回 `NULL`，讓 client 用「查得到 vs 查不到」判斷；錯誤字串仍由 client 拼。（第 3 步的 error 顯示改為 client-side 判斷）
- **不新增欄位、不改 grants 以外的 schema。**
