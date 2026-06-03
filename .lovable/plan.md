## 目標

只有「以 Line 註冊」的帳號，終身可獲得 **1 次** 免費收盤分析額度。
用完後（第 2 次起）必須訂閱 basic / pro 才能繼續使用；Email 註冊者一律無免費額度（第 1 次就要訂閱）。

## 識別「Line 註冊者」的方法

不能用 `profiles.line_user_id`（會把「Email 註冊後綁定 Line」的人誤判）。
**唯一可靠來源**：`auth.users.email` 符合 `line_*@line.local` 虛擬 email 規則（即 Line login channel 自動產生的帳號）。

## 額度語意改動

| 角色 | 現況 | 改後 |
|---|---|---|
| Tester | pro / month=22 | 不變 |
| 有 active checkup_subscriptions | 依方案 | 不變 |
| Line 註冊、未訂閱 | free 每月 1 次 | **終身 1 次**（用過就 0） |
| Email 註冊、未訂閱 | free 每月 1 次 | **0**（第 1 次就擋下） |

`checkup_usage` 已有「每次分析寫一筆」的紀錄，可直接用「lifetime count」判斷 Line 用戶是否還有額度。

## 技術變更

### 1. DB migration — 重寫 `public.check_checkup_quota`

判斷順序：
1. tester → pro/month/22
2. active subscription → 依 plan
3. 否則查 `auth.users.email`：
   - 符合 `line_%@line.local` → tier=`line_free`, period=`lifetime`, limit=1，`used` 取 `count(*) from checkup_usage where user_id=_user_id`（全期間）
   - 不符合 → tier=`none`, limit=0, used=0, remaining=0

`checkup_plans.quota_period` CHECK 擴充加入 `'lifetime'`。
`resets_at` 對 lifetime 回傳 `NULL`（或 `'infinity'::timestamptz`）。

`consume_checkup_quota` 邏輯不動（仍用 `check_checkup_quota` + advisory lock + 插入 usage），自動繼承新規則。

### 2. 前端額度顯示與引導

- `HoldingsQuotaMeter.tsx`：當 `tier === 'line_free'` 顯示「註冊禮 · 終身 1 次」、remaining=0 時 CTA 改成「升級訂閱」。
- `tier === 'none'`（Email 未訂閱）：直接顯示「訂閱後可使用收盤分析」並隱藏「剩 X 次」字樣。
- `429 QUOTA_EXCEEDED` 的提示文案要分流：
  - Line 終身免費已用完 → 「您的註冊免費額度已用完，升級方案後繼續使用」
  - Email 未訂閱 → 「收盤分析為訂閱功能，請先訂閱方案」
  - 兩種 CTA 都導 `/checkup/plans`（沿用現有訂閱流程，無單次購買）。

### 3. 影響到的測試與快取

- 既有 `1.x` quota 測試（如 checkup-helper-catalog、1.6-recurring-charge）需重跑並修正期待值。
- `useFreeCheckupBootstrap` / `useReportRefreshWorkflow` 若有快取 `tier === 'free'` 的 UI 分支，要加 `'line_free' | 'none'` 兩個新值。

### 4. 文件 / memory

- 更新 `mem://features/checkup/freemium-demo-strategy`：新規則（Line 終身 1 次、Email 0 次）。
- 在 `mem://features/checkup/specs-and-logic` 補上 tier 對應表。

## 不做的事

- 不新增單次購買 SKU、不動 checkout 流程。
- 不改 tester / pro / basic 額度。
- 不回溯處理「現在 free tier 每月用過的歷史用戶」——他們之後也走新規則（Line=終身剩 max(0, 1-used)、Email=0）。如果你想保留現有 Email 用戶當月已用過的權益，告訴我，再加遷移腳本。

## 驗證

1. SQL 單測：4 種帳號（tester / 訂閱中 / Line 未訂 used=0 / Line used≥1 / Email 未訂）呼叫 `check_checkup_quota` 回傳值正確。
2. Edge function：用 Line 虛擬帳號 JWT 呼叫 `checkup-analyze` 兩次，第 2 次回 429。
3. 用 Email 帳號呼叫 1 次即 429。
4. `bun vitest run` + `bunx playwright test e2e/freecheckup-card.spec.ts` 全綠。

確認方案，我就切 build 模式做 migration + 前端 + 測試。
