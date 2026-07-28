# Phase M — Edge Function Auth Guard 收斂

## 現況

- 52 支 edge functions 掛 `verify_jwt = false`，需自行驗證。
- 掃出 60+ 支使用 `serviceClient()` 卻未呼叫 `getCallerUserId` / `auth.getUser`。
- 但其中大多是 **合法的**：cron scheduler、provider webhook（ecpay/linepay/acpay 有簽章驗證）、公開查詢（og-card、checkup-sparkline）。
- 真正的風險是 **user-triggered、寫入高權限資源** 卻沒認證的那批。

## 目標

- 每一支 verify_jwt=false 的 edge function 都明確落在三類其中之一，並有 shared helper 執行對應防線：
  1. `user`：呼叫者 JWT → `requireCaller(req)`（失敗 401）
  2. `cron`：header `x-cron-key` 對 `CRON_SHARED_SECRET` → `requireCronKey(req)`（失敗 403）
  3. `webhook`：provider 簽章 → 該 provider 專屬 verifier（既有：`ecpayCredentials.ts` 等）
- 加一支 CI script 掃描：新增 edge function 若未 opt-in 三類之一，PR 直接紅。
- TDD 先寫。

## 步驟

### M1 — Shared guard + red test

- 新增 `supabase/functions/_shared/authGuard.ts`：
  - `requireCaller(req)`：包 `getCallerUserId`；null → throw `AuthError(401)`。
  - `requireCronKey(req)`：讀 `x-cron-key` header，對 `Deno.env.get('CRON_SHARED_SECRET')`；不符 → throw `AuthError(403)`。
  - `AuthError`：帶 status，讓 caller 直接轉 `errorResponse`。
- 新增 `authGuard_test.ts`（Deno test）：4 case（缺 token、bad token、good token、cron key 對錯）。

### M2 — 分類清單（doc）

- 新增 `docs/security/edge-function-auth-matrix.md`：三欄表格（function → class → verifier）。
- 由 `scripts/audit-edge-fn-auth.mjs` 產生初版；每支函式必須在表內。

### M3 — 套 helper（分批）

- Cron 類（scheduler-only）：`*-cron`, `*-scheduler`, `*-watchdog`, `alerts-watchdog`, `keep-warm-*` → 首行 `requireCronKey(req)`。
- Webhook 類：`ecpay-callback`, `checkup-ecpay-callback`, `acpay-notify`, `acpay-recurring-notify`, `line-webhook`, `linepay confirm` → 驗證維持 provider 簽章，加註解 `// AUTH: webhook-signature`。
- User 類：`checkup-analyze-enqueue`, `checkup-brain`, `create-*-order`, `admin-view-as`, `data-upsert`, `e2e-simulate-purchase`（已有）→ 首行 `await requireCaller(req)`。
- 每一批一次 commit，跑對應 edge function 既有 test。

### M4 — CI Gate

- `scripts/audit-edge-fn-auth.mjs`：parse `supabase/functions/*/index.ts`，若第一個 `Deno.serve` 內未偵測到 `requireCaller` / `requireCronKey` / 已知 webhook verifier annotation，exit 1。
- 加到 `.github/workflows/security-audit.yml`。

### M5 — Doc 同步

- 更新 `docs/security.md` 章節「Edge Function Auth 三分類」。
- 刪除 `.lovable/audit-2026-06-deep-scan.md` 已收斂的 A/C 組殘留註記（如已完成）。
- 本 phase 完成後於 `.lovable/plan.md` 記一行結案。

## 驗收

- `deno test supabase/functions/_shared/authGuard_test.ts` 綠。
- `node scripts/audit-edge-fn-auth.mjs` exit 0，且清單覆蓋 100% edge functions。
- `bunx playwright test e2e/live/subscription-end-to-end.spec.ts`（跑 e2e-simulate-purchase）綠 → 證明 user 類 guard 沒誤傷。
- CI security-audit workflow 綠。

## 不做

- 不動 provider 簽章邏輯（ecpay/line 已有既定驗證）。
- 不改 `verify_jwt = true` 那批（Supabase 已代驗）。
- 不動業務邏輯，只加/換 guard。
