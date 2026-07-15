## 問題根因（已就 8999.penguin@gmail.com 實際 DB 資料驗證）

該用戶的實際狀態：
- `auth.users`: 存在（user_id `d8fa2533…`）
- `user_roles`: `['analyst']`（已被後台開通）
- `experts`: 存在但 `status='pending'`, `created_by=null`, `name='Benny'`, `slug='benny'`（舊資料，非本次後台開通建立）

三個獨立缺陷疊在一起造成使用者感受到的斷點：

**1. `/company/users` 開分析師開關只給 role，不建 expert record**
`admin-manage-users` 的 `set_role` 只 upsert 到 `user_roles`，完全沒碰 `experts`。所以「開通後分析師頁沒顯示」——是因為對「新註冊、還沒有任何 expert row 的人」按開關，`experts` 表始終沒有那一列。

**2. `/company/analysts` 的清單沒有把 `status='pending'` 標示為「待補資料」**
`AnalystsTable` 只判斷 `status === 'suspended'`，其他一律顯示綠色「啟用中」badge。目前 12 筆裡有 6 筆 `status='pending'`、`created_by=null`（Benny/MK/Ele/老佛爺/Sean/永維），全部被誤標為啟用中且沒有「補齊資料」入口。

**3. `create-analyst` edge function 對「已有 analyst role」或「已有 expert row」一律硬擋 409**
沒有 upgrade / adopt 路徑，導致「想在分析師頁重新建立此人」永遠 400/409，即使目的是要補資料。

## 修復設計

### A. `admin-manage-users` — `set_role` 分析師時同步建立 expert 骨架
`set_role` action 內、當 `role === 'analyst' && enabled === true`：
- upsert `user_roles`（現行行為）
- 若 `experts.user_id = targetId` 不存在，插入一列：
  - `status = 'pending'`
  - `role = 'mentor'`（預設；後台可改）
  - `name = profiles.display_name` 或 `auth.email` 前綴
  - `slug = 'pending-' + substr(user_id,0,8)`（唯一、可辨識、之後於分析師頁改）
  - `created_by = callerId`
- 回傳 `{ ok: true, expert_created: true, expert_id, needs_setup: true }`

當 `role === 'analyst' && enabled === false`：
- 只刪 `user_roles` 那一列（現行行為）
- 若對應 `experts.status IN ('pending','suspended')` 且無訂閱者、無訊號 → 一併軟刪：`status='suspended'`（不硬刪保留稽核）
- 若已 `active` 或有訂閱者 → 保留 expert row，只回收 role，並在 response 標記 `expert_kept=true`

### B. `create-analyst` — 支援 adopt / upgrade 既有帳號
把「email 已存在」分支的三種硬擋改成幂等升級：

| 現況 | 現行行為 | 改為 |
|---|---|---|
| `experts` 存在且 `status='active'` | 409 | 保留 409 訊息，附上 `slug` 讓管理員知道去哪編輯 |
| `experts` 存在但 `status IN ('pending','suspended')` | 409 | UPDATE 該列：name/slug/role/bio/status='suspended'/created_by=caller，回傳 200 + `adopted:true` |
| `user_roles` 有 analyst 但無 `experts` | 409 | 走原本 insert experts 流程（不再擋） |
| 皆無 | 建立 | 現行行為 |

slug 衝突（不同 user_id 已佔用該 slug）仍要 409，並附「slug 已被 X 使用」訊息。

### C. `/company/analysts` UI — pending 狀態視覺化與補資料入口
`AnalystsTable` badge 邏輯改為三態：
- `suspended` → 紅色「已停用」
- `pending` → 琥珀色「待補資料」
- 其他 → 綠色「啟用中」

pending 列在操作區增加「補資料」按鈕，點擊開啟現有的 `CreateAnalystDialog`（以編輯模式打開，帶入 email/slug/name/role），送出時走 `create-analyst`（B 已支援 adopt）。

### D. `/company/users` UI — 分析師開關後給明確導向
`toggleRole` 成功時，若 `data?.needs_setup === true`：
- toast 顯示「已開通分析師，請至分析師管理補齊 slug/姓名/角色」
- 附「前往分析師管理」按鈕（`useNavigate` 到 `/company/analysts`）

### E. 資料補救（一次性 migration，不動 slug 只補 created_by）
6 筆 pending 舊資料補上 `created_by`（用當前操作 admin 的 id 不合適，改用 `null` 保留現況即可）— **這步略過**，改由 UI「待補資料」提示引導管理員逐一補齊，避免污染稽核歷史。

## 影響檔案

- `supabase/functions/admin-manage-users/index.ts` — set_role 分支擴充（A）
- `supabase/functions/create-analyst/index.ts` — 已存在分支重寫為 adopt（B）
- `src/pages/_companyAnalysts/AnalystsTable.tsx` — 三態 badge + 補資料按鈕（C）
- `src/pages/company/Analysts.tsx` — 接住補資料按鈕、預設 role/slug/email 帶入 CreateAnalystDialog
- `src/pages/_companyAnalysts/CreateAnalystDialog.tsx` — 標題與 CTA 依 mode 切換（新增／補資料）
- `src/pages/company/Users.tsx` — toggleRole 成功後跳轉提示（D）

## 不動範圍

- `experts` schema、RLS 不動
- Line 綁定、訂閱、payout 流程不動
- 分析師自助註冊路徑（若未來要開）另案

## 驗證清單

1. 新註冊帳號 `foo@bar` → `/company/users` 開分析師 → `/company/analysts` 立刻看到 `foo` 為「待補資料」
2. 點「補資料」→ 改 slug/name/role → 送出後變「已停用」（因 create-analyst 預設 status=suspended），再按「啟用」變綠色
3. 對同一 email 重複點「新增分析師」→ 不再 409，直接進 adopt 流程
4. 8999.penguin@gmail.com 進到分析師頁能看到 Benny（pending 態）並能透過「補資料」修正
5. 停權已有訂閱者的分析師 → 保留 expert row，只回收 role
