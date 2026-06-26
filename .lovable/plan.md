## 真正的根因（重新查證後）

剛剛說「忘了 grant」是錯的。重新查 DB：

1. `payment_providers` base table 只有一條 RLS policy：
   ```
   Company admins full access providers — USING (has_role(auth.uid(), 'company_admin'))
   ```
   完全沒有給一般 authenticated / anon 的 SELECT policy。
2. `payment_providers_safe` 是 view，建立時用 `security_invoker = true`（依專案 `safeViewAccess.ts` 註解），所以讀取時會帶上呼叫者身份去套 base table RLS → 一般使用者讀到 0 列。
3. 同時 view 對 `authenticated` / `anon` 也沒有 GRANT。

→ 結果：
- `edwillam1007@gmail.com`（普通會員）登入 `/checkout` → `providers = []` → 顯示「尚未設定可用的付款方式」。
- 「另一個可以付款的帳號」一定是 **company_admin 角色**（你或內部測試帳號），因為唯一 SELECT policy 只放 admin 過關。

這也跟現有測試 `1.35-rls-security-audit.test.ts` 的 G 段「`payment_providers_safe` 視圖仍可 anon 讀取」對不上 — 那個測試其實只驗證「不會 error」，並沒有 assert 拿到列數，所以漏掉這個 regression。

## 修正計畫

### 1. Migration：讓 `payment_providers_safe` 真的對前台可讀

view 已經把敏感欄位 `config` 去掉，是設計給前台讀的。改成 security definer 走 owner 權限，並補 GRANT：

```sql
-- 重建 view 為 security_invoker=false（以 owner postgres bypass base table RLS）
CREATE OR REPLACE VIEW public.payment_providers_safe
WITH (security_invoker = false) AS
SELECT id, provider_type, display_name, is_active, is_default,
       COALESCE(NULLIF(config->>'env',''), NULLIF(config->>'mode',''), 'production') AS env,
       created_at
  FROM public.payment_providers
 WHERE is_active = true;   -- 只暴露 active，避免列舉非啟用 provider

GRANT SELECT ON public.payment_providers_safe TO anon, authenticated;
```

保留 base table 的 admin-only policy 不動 → `config` 仍然只有 admin / service_role 看得到，安全姿態不變。

### 2. 補強回歸測試

更新 `src/test/integration/1.35-rls-security-audit.test.ts` G 段：
- 將「`payment_providers_safe` 可 anon 讀取」改成 assert `data!.length >= 1`（至少一筆 active provider）。
- 新增 case：anon SELECT 不會帶出 `config` 欄位（schema 層級保證）。

### 3. 驗證

- `supabase--read_query` 以 anon JWT 模擬：`select count(*) from payment_providers_safe` → ≥ 2。
- 用 `edwillam1007@gmail.com` 視角進 `/checkout/.../...`：可看到「綠界」「匯款／ATM 轉帳」兩個方式。
- 跑 `bunx vitest run src/test/integration/1.35-rls-security-audit.test.ts`。

## 範圍

- 1 個 migration（重建 view + grant）
- 1 個測試檔修改
- 前端與 base table policy 都不動
