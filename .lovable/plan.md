## 目標
`/company/analysts` 每一列加一顆「帳號」按鈕，company_admin 可以對該分析師做：
1. **改 Email**（同步更新 `auth.users.email` 與 `profiles`）
2. **直接重設密碼**（後台輸入新密碼立即覆蓋）
3. **寄出密碼重設信**（寄到該分析師信箱讓他自己改）

全部走新 edge function，service role + company_admin 雙重驗證 + audit log，並沿用既有 Resend / Lovable Email 寄信管道。

---

## 後端：新增 `update-analyst-credentials` edge function

**路徑**：`supabase/functions/update-analyst-credentials/index.ts`

**驗證流程**（與 `create-analyst` 同模式）：
1. 取 `Authorization` header → `auth.getUser()` → 必須有 `company_admin` role，否則 403
2. body：`{ expert_id: uuid, action: 'update_email' | 'reset_password' | 'send_reset_email', email?, new_password? }`
3. 由 `expert_id` 反查 `experts.user_id` 取得目標 auth user

**三個 action**：

### A. `update_email`
- 用 service role `auth.admin.updateUserById(targetUserId, { email, email_confirm: true })`
- 同步 `profiles`（若有 email 鏡像欄位則更新；目前 profiles 沒有 email 欄位，僅做 auth 更新即可）
- 拒絕修改虛擬 LINE email（`@line.local` 結尾）以免破壞 LINE 登入綁定

### B. `reset_password`
- 驗證密碼 ≥ 6 碼
- `auth.admin.updateUserById(targetUserId, { password: new_password })`
- 不寄信，直接生效

### C. `send_reset_email`
- 用 service role `auth.admin.generateLink({ type: 'recovery', email: targetEmail, options: { redirectTo: `${SITE_URL}/reset-password` } })`
- 取得 `action_link` 後透過既有 Resend 整合寄到該分析師信箱
- 標題「【LegendFlow】分析師後台密碼重設」，內文含一次性連結

**Audit log**：每個 action 都寫一筆 `audit_logs`，`action='update_analyst_credentials'`，`detail` 含 `{ sub_action, target_user_id, new_email? }`（不存密碼）

**CORS**：與現有 edge functions 一致

---

## 前端：`src/pages/company/Analysts.tsx`

### 新按鈕
在每列操作欄、「LINE / 後台 / 啟用」之間加一顆：
```tsx
<Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => openAccountDialog(exp)}>
  <Key className="h-3 w-3 mr-1" />帳號
</Button>
```

### 新 Dialog「`{exp.name} — 帳號設定`」
三個分頁（Tabs）：
1. **改 Email** — 顯示目前 email（從 `auth.admin` 拿不到，改用 edge function 回傳；或改用 input 讓 admin 直接輸入新值）→ 「更新 Email」按鈕
2. **重設密碼** — 兩個 input（新密碼 / 確認新密碼）→ 「立即重設」按鈕（含確認對話框防誤觸）
3. **寄重設信** — 顯示目標 email，「發送重設密碼信」按鈕

呼叫：`supabase.functions.invoke('update-analyst-credentials', { body: { expert_id, action, ... } })`，成功 toast，失敗顯示 error message。

### 取得目前 Email
Edge function 在初始 GET / 回應時帶回 `current_email`，前端 dialog 開啟時先 invoke 一次 `action='fetch_email'`（第 4 個唯讀 action）拿到顯示。

---

## 安全要點
- 全程在 edge function 端驗證 `has_role('company_admin')`，不依賴前端
- 拒絕對 `@line.local` 虛擬信箱改 email（會破壞 LINE 登入隔離，符合 mem://auth/account-identity-isolation）
- 拒絕對自己（caller 自己的帳號）改密碼／email — 改自己的請走 `/account/profile`，避免誤鎖
- 密碼最小長度 6（與 `create-analyst` 一致）
- 不在 audit log 存任何密碼明文

---

## 待確認
- 「寄重設信」的寄送管道：直接用既有 `RESEND_API_KEY` 透過 Resend 連接器發送（不需要 Lovable Auth Email Hook）。標題與內文我會用繁中。確認可以這樣做嗎？
- 「改 Email」是否要同步寄一封通知信到舊信箱（防被惡意改走）？建議要，但會多一次 Resend call。

要我直接照這個計畫做嗎？