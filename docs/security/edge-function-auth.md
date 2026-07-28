# Edge Function Auth 三分類憲法

> Phase M 收斂（2026-07-27）。所有 `supabase/functions/*/index.ts` 必須在檔案內明確宣告一種 auth class，`scripts/audit-edge-fn-auth.mjs` 是 CI gate，違反 PR 直接紅。

## 三分類

| Class | 適用 | 標記方式 | 執行 |
| --- | --- | --- | --- |
| `user` | 前端呼叫、需要 caller 身份 | `await requireCaller(req)` 或註解 `// AUTH: user` | 失敗 → 401 `UNAUTHENTICATED` |
| `cron` | pg_cron / scheduler-only | `requireCronKey(req)` 或註解 `// AUTH: cron` | 缺 `X-Cron-Key` → 403 `FORBIDDEN_CRON` |
| `webhook-signature` | 第三方 provider callback | 註解 `// AUTH: webhook-signature`（實際靠 ECPay CheckMacValue / LINE signature / ACpay MAC 等 provider verifier） | 由 provider verifier 把關 |
| `public` | 刻意公開（OG image、公開查詢、traffic ingest 等） | 註解 `// AUTH: public` | 無 guard，但需輸入驗證與速率限制 |

Shared helper：`supabase/functions/_shared/authGuard.ts`。

## 分類矩陣

見 [`edge-function-auth-matrix.md`](./edge-function-auth-matrix.md)（由 `node scripts/audit-edge-fn-auth.mjs --write` 自動生成）。

## 兩階段收斂

**Phase M-1（已完成）**：所有 126 支 edge functions 全數分類，CI gate 上線。

**Phase M-2（burn-down，待辦）**：矩陣中「Runtime Guard = ⏳ pending」的 71 支需要把註解 marker 換成實際 `requireCaller(req)` / `requireCronKey(req)` 呼叫。前置條件：

- Cron 類：先在 Lovable Cloud 設 `CRON_SHARED_SECRET`，並讓所有 pg_cron `net.http_post` 帶 `X-Cron-Key` header。切換前跑一次 cron dry-run 驗證。
- User 類：確認呼叫端已帶 Supabase JWT；ECPay 訂單建立類（`create-*-order`）需先確認 checkout 流程是登入後才走。

Burn-down 進度追蹤方式：`node scripts/audit-edge-fn-auth.mjs --write` 後 diff `docs/security/edge-function-auth-matrix.md` 的 pending 數。

## 新增 edge function checklist

1. 決定 class（見上表）
2. 在 `index.ts` 最上方加對應 marker/呼叫
3. 若是 user 類，在 handler 內 `try { await requireCaller(req) } catch (e) { if (e instanceof AuthError) return errorResponse(e.message, e.status, { code: e.code }); throw e; }`
4. 執行 `node scripts/audit-edge-fn-auth.mjs` 確認綠

## 驗收

- `node scripts/audit-edge-fn-auth.mjs` 綠 → 100% 分類
- `deno test supabase/functions/_shared/authGuard_test.ts` 5/5 綠
- `.github/workflows/security-audit.yml` 的 `edge-fn-auth-matrix` job 綠
