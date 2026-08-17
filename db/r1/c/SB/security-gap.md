# Security gap — `public.payment_providers_safe` (Critical: Security Definer View)

狀態：**只記錄，不修**。本輪未執行任何 migration、未 Ignore finding、未使用 Try-to-fix-all。
production 0 touch。以下全部為唯讀查詢結果（2026-08-17）。

## 1. Exact object

| 欄位 | 值 |
|---|---|
| object | `public.payment_providers_safe` |
| relkind | `v`（view） |
| owner | `postgres`（superuser-equivalent；view 以 owner 權限執行） |
| reloptions | `NULL` → **沒有 `security_invoker`**，即等同 `security_invoker = false`（SECURITY DEFINER view 語義） |
| relrowsecurity（view 本身） | `false`（view 不套 RLS，一律看底表） |

最後一次刻意設定：`supabase/migrations/20260721155906_...sql` → `ALTER VIEW public.payment_providers_safe SET (security_invoker = false);`
更早 `20260626090347_...sql` 註記原因：`security_invoker=true` 會被底表 admin-only RLS 擋住，結帳讀不到資料。
→ 這是**刻意**的繞過，不是漏設。

## 2. View definition（唯讀取得）

```sql
SELECT id, provider_type, display_name, is_active, is_default,
       COALESCE(NULLIF(config ->> 'env',''), NULLIF(config ->> 'mode',''), 'production') AS env,
       created_at
  FROM payment_providers
 WHERE is_active = true;
```

未輸出 `config` 全欄（金鑰/商店代號等敏感內容）；只輸出 `config->>'env' | 'mode'` 這個非敏感標記。

## 3. Grants / ACL

```
view  relacl : postgres=arwdDxtm/postgres | anon=arwdDxtm/postgres | authenticated=arwdDxtm/postgres |
               service_role=arwdDxtm/postgres | sandbox_exec*=ar/postgres
base  relacl : postgres=arwdDxtm/postgres | anon=arwdDxtm/postgres | authenticated=arwdDxtm/postgres |
               service_role=arwdDxtm/postgres | sandbox_exec*=ar/postgres
column-level grants on the view : (none)
```

`GRANT SELECT ON public.payment_providers_safe TO anon, authenticated`
見 `20260626090347` 與 `20260721155612`。ACL 顯示 anon/authenticated 實際持有 `arwdDxtm`（含寫入位元），
遠超過 view 需求 —— 這是第二個獨立問題（over-grant），與 definer 語義互相疊加。

## 4. Base table 與 RLS

- `public.payment_providers`：`relrowsecurity = true`（admin-only policies）。
- 因為 view 是 definer 語義且 owner = `postgres`，**底表 RLS 對經由此 view 的讀取完全不生效**。

## 5. Exposure 評估

| 面向 | 結論 |
|---|---|
| 敏感欄位外洩 | **沒有**：`config` 未被投影；只輸出 env/mode 標記與顯示名稱 |
| 未授權讀取 | anon 可讀「啟用中的金流商清單」。這是結帳頁需要的公開資訊 |
| 真正的風險 | (a) definer view 是繞過 RLS 的長期後門，未來只要有人在 view 加一欄 `config`，anon 立刻拿到金鑰；(b) anon/authenticated 對 view **與底表**都有 `arwdDxtm`，寫入位元不該存在 |
| 跨範圍影響 | `src/hooks/checkout/useCheckoutData.ts:70`、`src/lib/safeViewAccess.ts:70` — 動它會直接影響結帳可用性 |

## 6. 建議方案（未執行）

1. **保留 definer 語義但收斂權限（最低風險，建議先做）**
   - `REVOKE ALL ON public.payment_providers_safe FROM anon, authenticated;`
   - `GRANT SELECT (id, provider_type, display_name, is_active, is_default, env, created_at) ON public.payment_providers_safe TO anon, authenticated;`
   - 底表同樣 `REVOKE ALL ... FROM anon, authenticated`（結帳只走 view）。
   - 效果：欄位級白名單，未來誰在 view 加 `config` 也讀不到；結帳路徑不變。
2. **改回 `security_invoker = true` + 明確的 read policy（根治，需要回歸測試）**
   - `ALTER VIEW ... SET (security_invoker = true);`
   - 在 `payment_providers` 加 `FOR SELECT TO anon, authenticated USING (is_active)` 且不含 `config` 的欄位級 grant。
   - 風險：`20260626090347` 記載過這條路徑曾造成結帳讀不到資料，必須先在 disposable clone 演練（建議代號 PPS1/PPS2），並跑結帳 E2E。
3. 兩案都不應在本輪與 Stage B 混在同一 migration —— 影響範圍不同、rollback 面不同。

## 7. Scan 現況

見 `full-regression-receipt.md` 的 security scan 區段：本輪所有 code/artifact 變更完成後重掃，
`payment_providers_safe` 仍是**唯一且既有**的 Critical finding，未被 Ignore、未被自動修復。

### 7.1 Latest live scan（使用者親自執行，2026-08-17T17:32Z，畫面「Basic scan completed 15 seconds ago」）

| 項目 | 值 |
|---|---|
| Detected Issues | 1 Critical = `SUPA_security_definer_view`（`public.payment_providers_safe`），與本文件一致 |
| Project dependencies | **77 packages / 40 known vulnerabilities**（先前記錄為 29） |

唯讀查證（2026-08-17T17:33:19Z）：本輪**沒有任何相依變更**。`package-lock.json` / `bun.lock` / `bun.lockb`
mtime 皆為 Aug 17 00:34（本輪之前）且 `git status` 0 變更；本輪 `package.json` 的 5 次提交只動 `scripts` 區塊，
`dependencies` / `devDependencies` 0 位元變更。sha256：`package.json` = `1f4cfbbd…926ef4`、
`package-lock.json` = `fbf9a41c…1da9aca`。

→ 29 → 40 記為 **scanner advisory database / count drift**。

未升級套件邊界：本輪未執行 install/update/audit fix、未改 lockfile、未改相依宣告、未修 payment view、
未 deploy、未 Publish。40 筆漏洞與本 Critical finding 皆維持原狀，僅盤點。

