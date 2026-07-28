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

## M-3b（完成 2026-07-28）— pg_cron 命令徹底清理
- `public.admin_list_cron_jobs()` 唯讀函式（PUBLIC 可執行、僅回排程 metadata）供稽核使用。
- Migration DO block 掃描 `cron.job`，自動把所有 `net.http_post(...)` 命令重排為 `SELECT public.cron_edge_call(fn, body::jsonb);`，anon key / X-Cron-Key 完全撤出 `cron.job.command`。
- 執行結果：59 個 cron job → 50 個走 `cron_edge_call`、9 個為純 SQL 清理任務（無 HTTP）、0 個裸 `net.http_post`。
- `scripts/audit-pg-cron-commands.mjs` 呼叫 `admin_list_cron_jobs` RPC 逐條檢核，命中任何裸 `net.http_post` 立即 exit 1。
- `.github/workflows/security-audit.yml` 新增 `pg-cron-command-gate` job，PR/推送皆阻擋 regression。

## M-3c（完成 2026-07-28）— E2E Auth Contract 覆蓋
- `_shared/authContract_e2e_test.ts`：讀 matrix，user class 全數斷言 401 / cron class 全數斷言 403|503（含 bogus X-Cron-Key）。
- **M-3c-2（完成）**：cron class 57/57 live 契約通過；guard 前置修正 8 支、reclassify 5 支為 user。
- **M-3c-3（完成 2026-07-28）**：`_shared/webhookContract_e2e_test.ts` 覆蓋 6 支 webhook（acpay-notify / acpay-recurring-notify / checkup-ecpay-callback / ecpay-callback / confirm-linepay / line-webhook），以 provider-specific rejection sentinel（`^FAIL` / `err_code:"1"` / `^0|` / 4xx）斷言未簽章請求被拒。6/6 live 綠。
- CI：`.github/workflows/edge-fn-auth-contract.yml` 每次 push/PR 跑 user+cron+webhook 三個契約 job；`supabase/functions/**` 或 matrix 變動觸發。

## 驗收指令
```bash
node scripts/audit-edge-fn-auth.mjs
node scripts/audit-pg-cron-commands.mjs
deno test supabase/functions/_shared/authGuard_test.ts supabase/functions/_shared/authFailureSpike_test.ts --allow-env --allow-net
deno test --allow-net --allow-env --allow-read --no-check supabase/functions/_shared/authContract_e2e_test.ts
deno test --allow-net --allow-env --allow-read --no-check supabase/functions/_shared/webhookContract_e2e_test.ts
```

## Phase M — 收斂完成
M-1 到 M-3c 全數關閉；125 支 edge functions 皆有 auth marker + runtime guard + live 契約覆蓋；pg_cron 全走 `cron_edge_call`；auth 失敗有 spike 監控 + LINE 告警。

## M4（完成 2026-07-28）— CI Gate 鎖定
- `scripts/audit-edge-fn-auth.mjs` 新增 `--strict`：user/cron class 若只有 `// AUTH:` marker、沒有 runtime guard 直接失敗（目前 pending=0 已鎖）。腳本同時輸出 `GITHUB_STEP_SUMMARY`（class breakdown + pending/unclassified 清單）。
- 新 workflow `.github/workflows/edge-fn-auth-gate.yml` 聚合三段門檻：
  1. `static-gate`：`audit-edge-fn-auth --strict` + `audit-pg-cron-commands`
  2. `live-contract`：`authContract_e2e_test.ts` + `webhookContract_e2e_test.ts`
- 舊 `edge-fn-auth-contract.yml` 併入新 gate 後刪除。兩個 job 均為 main branch required check；任何 unclassified fn / marker-only guard / 生 `net.http_post` / 契約破損都會擋 PR。

