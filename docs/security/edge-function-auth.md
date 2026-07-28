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

## 收斂進度

- **M-1（完成）**：126 支 edge functions 全數分類，CI marker gate 上線。
- **M-2（完成）**：71 支 pending 全數換成 runtime guard；`CRON_SHARED_SECRET` + `public.internal_cron_secrets` + `public.cron_edge_call()` 就位。
- **M-3a（完成）**：`edge_function_auth_events` + `alerts-watchdog` spike 監控。
- **M-3b（完成）**：所有 pg_cron job 從裸 `net.http_post` 遷移到 `public.cron_edge_call(fn, body)`，`scripts/audit-pg-cron-commands.mjs` + CI job `pg-cron-command-gate` 阻擋 regression。
- **M-3c（完成）**：End-to-end Auth Contract 覆蓋（user + cron + webhook 三軌）。
- **M-4（完成 2026-07-28）**：`--strict` gate + 聚合 workflow `edge-fn-auth-gate.yml`（static + live）成為 main branch required check。
- **M-5（完成 2026-07-28）**：全套驗收 + 殘留違反者修復 + doc 同步。
  - `checkup-parse` / `checkup-predict-events`：前置 `requireCaller`（method check 後、body parse 前）→ 401 契約通過。
  - `publish-weekly-journals`：改分類為 `cron`（hybrid），前置 `requireCronKey` OR `requireCaller`，scheduler 與老師提前發布分別走各自 credential，兩者皆缺 → 403。
  - 125/125 classified、Runtime guard 125/125、pending=0；user + cron + webhook 契約皆綠。


## pg_cron 排程規範（M-3b）

新排程 job 一律用：

```sql
SELECT cron.schedule(
  'job-name',
  '*/5 * * * *',
  $$SELECT public.cron_edge_call('edge-fn-name', '{"foo":"bar"}'::jsonb);$$
);
```

**禁止**在 `cron.job.command` 內直接寫 `net.http_post(...)`——會把 anon key 與 `X-Cron-Key` 塞進 `cron.job.command`，且 secret rotation 需逐條改。CI `pg-cron-command-gate` 會 fail。

純 SQL 維護 job（如 `SELECT public.cleanup_*()`）不受此規範限制。

## 新增 edge function checklist

1. 決定 class（見上表）
2. 在 `index.ts` 最上方加對應 marker/呼叫
3. 若是 user 類：`try { await requireCaller(req) } catch (e) { if (e instanceof AuthError) return errorResponse(e.message, e.status, { code: e.code }); throw e; }`
4. 若排程觸發：透過 `public.cron_edge_call('fn-name', body)` 呼叫，不要自己寫 `net.http_post`。
5. 執行 `node scripts/audit-edge-fn-auth.mjs` 與 `node scripts/audit-pg-cron-commands.mjs`。

## 驗收

- `node scripts/audit-edge-fn-auth.mjs` 綠
- `node scripts/audit-pg-cron-commands.mjs` 綠（legacy=0）
- `deno test supabase/functions/_shared/authGuard_test.ts supabase/functions/_shared/authFailureSpike_test.ts` 綠
- `.github/workflows/security-audit.yml` 的 `edge-fn-auth-matrix` 與 `pg-cron-command-gate` job 綠
