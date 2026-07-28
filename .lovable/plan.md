# Phase M — Edge Function Auth Guard 收斂

## M-1（完成 2026-07-27）
- `_shared/authGuard.ts`：`requireCaller` / `requireCronKey` / `AuthError`。
- 126 支 edge functions 全分類、`scripts/audit-edge-fn-auth.mjs` 掛入 CI。
- 憲法：`docs/security/edge-function-auth.md`；矩陣：`docs/security/edge-function-auth-matrix.md`。

## M-2（完成）
- `CRON_SHARED_SECRET` 部署，`public.internal_cron_secrets` + `public.cron_edge_call()` 建置。
- 50+ pg_cron jobs 透過 `cron.alter_job` 注入 `X-Cron-Key`。
- 65 支 pending 函式批次注入 `requireCaller` / `requireCronKey`；125/125 全綠。

## M-3a（完成 2026-07-28）— Auth 失敗監控 + 告警
- 新增 `public.edge_function_auth_events`（service_role only、7 天保留、`cleanup_old_auth_events()`）。
- `_shared/authGuard.ts` 於每次 401/403/503 fire-and-forget 寫入事件（`AUTH_EVENT_LOGGING=0` 可關閉，測試預設關閉）。
- 純函式 `_shared/authFailureSpike.ts` + Deno 測試 7/7 綠：15 分鐘視窗，per-fn 分組，>=10 warning、>=30 critical。
- `alerts-watchdog` 新增 `checkAuthFailureSpike`（並聯至 `Promise.allSettled`），觸發時寫 `system_alerts` 並經 LINE push。
- Webhook 類函式可用 `recordWebhookRejection(req, provider, reason)` 匯入同一監控管線。

## M-3b（進行中）— pg_cron 命令徹底清理
- 目標：所有 pg_cron job 從裸 `net.http_post(...)` 遷移至 `public.cron_edge_call(fn, body)`（自動注入 `X-Cron-Key`）。
- 交付：`scripts/audit-pg-cron-commands.mjs` + CI gate，偵測 `command` 內是否仍含 `net.http_post`。

## M-3c（待開）— E2E Auth Contract 覆蓋
- user / cron / webhook 各取樣一支代表函式，於 CI 打 401/403/成功路徑，斷言 status + code。
- 交付：`e2e/edge-fn-auth-contract.spec.ts`。

## 驗收指令
```bash
node scripts/audit-edge-fn-auth.mjs
deno test supabase/functions/_shared/authGuard_test.ts supabase/functions/_shared/authFailureSpike_test.ts --allow-env --allow-net
```
