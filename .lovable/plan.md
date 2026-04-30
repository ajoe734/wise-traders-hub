# 配額系統四步修復計畫

針對前一輪盤點出來的四個破口，一次補齊。目標：使用者打開 `/free-checkup` 持倉看板就看得到配額卡、撞到限額會跳清楚 Modal、升級按鈕真的連得到付費頁、截圖解析也會扣配額。

---

## Step 1：`checkup-parse` 補上配額消耗

**檔案**：`supabase/functions/checkup-parse/index.ts`

目前截圖解析完全沒接 `consumeCheckupQuota`，使用者狂傳截圖也不扣次數。

- 在 `Deno.serve` 進入 POST 流程後、呼叫 Vision 之前，先 `await consumeCheckupQuota(req, 'parse', corsHeaders)`。
- 若回傳 `ok:false` → 直接 `quotaErrorResponse(...)` 回 401/429。
- 成功時把 `result.quota` 一併回傳給前端：`{ content: [...], quota }`，讓前端可呼叫 `applyQuotaFromResponse`。
- 部署：`supabase--deploy_edge_functions(["checkup-parse"])`。

---

## Step 2：升級連結改指向真實路由

**檔案**：`src/pages/FreeCheckup.jsx`

目前 4 處升級 CTA 寫的是 `/checkup-checkout`（不存在）。專案實際路由：
- 方案總覽：`/pricing`
- 結帳頁：`/checkout/checkup/{planId}`（需要 planId）

統一處理：
- QuotaMeter 右上「升級 →」 → `/pricing#checkup`
- QuotaModal 主 CTA「升級 Basic」/「升級 Pro」 → `/pricing#checkup`
- 「限額用完」區塊次 CTA「查看方案」 → `/pricing#checkup`
- 手動刷新被擋的提示「升級 Basic 解鎖手動刷新」 → `/pricing#checkup`

全部用 `<Link to="/pricing#checkup">` 或 `navigate('/pricing#checkup')`，不再寫 `/checkup-checkout`。

---

## Step 3：QuotaMeter 無條件渲染 + 訪客 fallback

**檔案**：`src/pages/FreeCheckup.jsx`

目前 QuotaMeter 在 `isDemo` 或 `quota` 還沒 fetch 完時整塊不 render，導致使用者「看不到任何東西」誤以為沒做。

改為：
- 在 `tab === 'holdings'` 區塊頂端**無條件**插入 `<div className="checkup-quota-meter wb-card">`。
- 三種狀態：
  1. **訪客（mode==='demo'）**：顯示「登入後解鎖每月 1 次免費 AI 健檢」+ 主 CTA「立即登入」（呼叫 `startLineLogin` 或導向 `/auth/login`）+ 次 CTA「查看付費方案 →」(`/pricing#checkup`)。
  2. **載入中（isReady=false 或 quota==null 但有 user）**：顯示 skeleton bar + 文字「載入配額中…」。
  3. **已登入**：原本設計的 Tier 徽章 + `used/limit` 進度條 + `formatResetCountdown(quota.resets_at)` + 升級 CTA（Pro 不顯示）。
- 樣式進 `<style>` block，確保 560/390/380px 三斷點不溢出（依 [手機回歸清單](mem://qa/checkup/freecheckup-mobile-regression-checklist)）。

---

## Step 4：截圖解析成功後同步配額

**檔案**：`src/pages/FreeCheckup.jsx`（搜 `parseShot` / `checkup-parse` 呼叫處）

- 解析成功收到回應後，若 `data.quota` 存在 → `applyQuotaFromResponse(data)`；否則 `await refreshQuota()`。
- 解析失敗且 `isQuotaExceeded(res)` → 跳 QuotaModal、不寫 `dailyLastError`。
- 同樣處理 `runDailyAnalysis`、事件預測、深度研究三個 AI 入口（前一輪已部分接上，這輪統一補完並驗證）。

---

## 驗收清單（強制）

依 [FreeCheckup 手機回歸清單](mem://qa/checkup/freecheckup-mobile-regression-checklist)：

1. 訪客打開 `/free-checkup` 持倉看板 → 頂部看得到「登入解鎖」配額卡。
2. 免費登入用戶 → 看到「免費版 · 本月 0/1 · 距離重置 X 天」。
3. 用完 1 次後再點任一 AI 按鈕 → 跳 QuotaModal（非 toast），顯示重置時間 + 升級 CTA。
4. 點「升級」→ 真的進到 `/pricing#checkup`（不是 404）。
5. 截圖解析會讓 `used` +1（後端 RPC 真的有寫 `checkup_usage`）。
6. 560/390/380px 截圖無 overflow，跑 `bunx playwright test e2e/freecheckup-card.spec.ts`。

---

## 不會動的東西

- 不改 RPC（`consume_checkup_quota` / `check_checkup_quota` 已 OK）。
- 不改 `checkup_plans` schema、不改 `CheckupModeContext.jsx` 的 API 形狀。
- 不抽 component（遵守 [FreeCheckup inline 限制](mem://architecture/checkup/inline-rendering-audit)）。
- 不違反 [損益顏色憲法](mem://style/holdings/monochrome-orange-pnl)（QuotaMeter 用 teal/amber/down，非損益場景，OK）。
