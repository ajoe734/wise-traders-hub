# Phase M — Edge Function Auth Guard 收斂（已完成 2026-07-27）

## 成果

- `supabase/functions/_shared/authGuard.ts` 上線：`requireCaller` / `requireCronKey` / `AuthError`。
- `supabase/functions/_shared/authGuard_test.ts` 5/5 綠。
- 126 支 edge functions 全數分類（user 43 / cron 63 / webhook 6 / public 14）。
- `scripts/audit-edge-fn-auth.mjs` CI gate 掛入 `.github/workflows/security-audit.yml → edge-fn-auth-matrix` job：新函式若未帶 AUTH marker，PR 直接紅。
- 分類矩陣：`docs/security/edge-function-auth-matrix.md`（腳本自動產生，勿手動編輯）。
- 憲法文件：`docs/security/edge-function-auth.md`。

## 已知殘留（Phase M-2 burn-down）

71 支函式目前只有 marker 註解、尚無 runtime guard。詳細名單與前置條件見 `edge-function-auth.md`。優先順序（若下一輪要開）：

1. Cron secret 部署：先設 `CRON_SHARED_SECRET`，改 pg_cron `net.http_post` 帶 `X-Cron-Key`，再把 cron 類的 marker 換成 `requireCronKey(req)`。
2. User 類 write ops（`create-*-order`, `checkup-analyze-enqueue`, `checkup-brain`, `data-upsert`, `admin-*`）逐支換 `await requireCaller(req)`，每支跑對應 e2e。

## 驗收指令

```bash
node scripts/audit-edge-fn-auth.mjs        # 分類 100% 綠
deno test supabase/functions/_shared/authGuard_test.ts --allow-env --allow-net
```

Phase M-1 收斂完成，進入維護模式；新開函式必走 `docs/security/edge-function-auth.md` checklist。
