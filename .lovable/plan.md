
## 背景

- `/company/users`（所有註冊帳號）與 `/company/subscribers`（付費訂閱會員）其實已存在，但入口埋在側欄裡不明顯。
- 目前完全沒有 admin「以會員視角檢視」的機制，debug 訂閱者畫面時只能拿真帳號登入。

## A. 會員管理入口重整

### A1. CompanyLayout 側欄分組
把現有 12+ 個項目分組為「會員 / 營收 / 內容 / 系統」四類，會員區塊置頂：
- 會員總覽（新）
- 註冊帳號（= Users）
- 訂閱會員（= Subscribers）
- 匯款訂單（= Remittance）

### A2. 新增 `/company/members` 總覽頁
單頁 dashboard，含：
- KPI 卡：總註冊數 / 今日新增 / 付費會員數 / Line 綁定率 / 7 日活躍
- 最近註冊 10 筆（連到 Users 詳細）
- 即將到期訂閱 10 筆（連到 Subscribers）
- 兩顆主 CTA：「管理所有帳號」「管理訂閱會員」

資料來源全部走既有 `admin-manage-users` edge function 與 `member_subscriptions`，不新增 RPC。

## B. View-as 唯讀預覽

讓 admin 在 Users / Subscribers / Members 任一列點「以此會員視角檢視」，新分頁開啟 `/app`，整個 app 以該 user 的資料渲染但**禁止任何寫入**。

### B1. Edge function `admin-view-as-member`
- 入參：`target_user_id`
- 驗證呼叫者具 `company_admin` role（has_role）
- 簽發短效（15 分鐘）一次性 token 寫入 `admin_view_as_sessions` 表，回傳 token
- 寫入 `audit_logs`：`view_as_started`，含 admin id + target id + ip

### B2. 新表 `admin_view_as_sessions`
```
id uuid pk
admin_user_id uuid not null
target_user_id uuid not null
token text not null unique
expires_at timestamptz not null
revoked_at timestamptz
created_at timestamptz default now()
```
RLS：僅 service_role 可讀寫；GRANT ALL TO service_role。

### B3. 前端 `ViewAsContext`
- `/app/view-as?token=xxx` 路由：呼叫 `admin-view-as-resolve` 換到 `{ adminId, targetUserId, expiresAt }`，存入 React context（**非 localStorage**，避免污染真實 session）
- 包覆 `UnifiedAppLayout`：當 context 有 targetUserId，所有 `useAuth().user.id` 的下游 hook（`useMemberSubscriptions` / `useAccountData` / `useMyTradeRecordHoldings` / `useFreeCheckupBootstrap`）改讀 `effectiveUserId = viewAs?.targetUserId ?? auth.user.id`
- 加 `useEffectiveUserId()` hook 統一收口，逐一替換上述 hook 的 `user.id` 取得處
- 頂部固定紅色橫條：「👁 正以 {target email} 視角檢視 · 剩 {n} 分鐘 · [退出]」
- **寫入鎖**：在 `supabase` client 包一層 proxy，view-as 模式下 `.insert/.update/.delete/.upsert/.functions.invoke` 直接 reject 並 toast「預覽模式不可操作」。對 `rpc` 白名單只放唯讀 RPC（`get_expert_detail_bundle` 等）。

### B4. 安全護欄
- token 一次性消費（resolve 後 revoke）
- 15 分鐘過期自動踢出
- 退出時清 context + 關閉分頁
- 真實 admin session 維持不變（不覆蓋 supabase auth token）
- 寫入鎖以「全域 supabase client wrapper」實作，攔截點放在 `src/integrations/supabase/client.ts` 外層 re-export，原檔不動

### B5. 測試
- Vitest：`useEffectiveUserId` 切換邏輯、寫入鎖 reject 行為
- Playwright：admin 觸發 view-as → 新分頁渲染目標訂閱清單 → 嘗試取消訂閱被擋 → 退出回原狀

## C. 技術細節

| 變更 | 檔案 |
|---|---|
| 側欄分組 | `src/components/layouts/CompanyLayout.tsx` |
| 會員總覽頁 | `src/pages/company/Members.tsx`（新） + router 註冊 |
| view-as edge | `supabase/functions/admin-view-as-member/index.ts`（新）+ `admin-view-as-resolve/index.ts`（新） |
| 新表 migration | `admin_view_as_sessions` + RLS + GRANT |
| view-as context | `src/contexts/ViewAsContext.tsx`（新）、`src/hooks/useEffectiveUserId.ts`（新） |
| client wrapper | `src/integrations/supabase/safeClient.ts`（新；既有 `client.ts` 不動） |
| hook 改寫 | `useMemberSubscriptions` / `useAccountData` / `useMyTradeRecordHoldings` / `useFreeCheckupBootstrap` 等共 6–8 處改用 `useEffectiveUserId()` |
| 觸發按鈕 | `Users.tsx` / `Subscribers.tsx` / 新 `Members.tsx` 每列加「視角檢視」MenuItem |

## D. 風險

- DB 端 RLS 仍以**真實 admin** 身分查詢，所以 admin 看得到的就是「admin 能讀到的 + 過濾 target_user_id 的子集」；不會繞過 RLS 取得 admin 本來不能讀的資料 → 符合最小權限。
- 寫入鎖純前端，若 admin 改 console 仍能寫入，但會以**真實 admin 身分**寫入而非偽造目標，audit 可追溯，可接受。
- 不影響既有 `usePreviewMode`（subscriber preview）。

## E. 不做的事

- 不簽發目標使用者的真 JWT（避免 session 污染與 audit 偽造）
- 不在 localStorage 留任何 view-as 狀態
- 不對 service_role token 做客戶端暴露
