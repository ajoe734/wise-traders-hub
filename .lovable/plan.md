# 系統優化 / 程式維護簡化 — 新計劃（2026/05/18）

距上次盤點已完成：lucide tree-shake、preconnect、refundProcessor 跨界 import、Index.tsx hero 以外段落 lazy、INP/CLS RUM、bundle-snapshot CI、AuthContext 拆 state/actions、Edge `_shared/` 共用層骨架（cors/logger/clients/README）。

以下是**剩餘**且 ROI 高的工作，依「影響面 × 解決成本」重排。

---

## P0 — 立即可做、效果明顯

### A1. FreeCheckup TradeTab 抽出 + runtime hook 收斂
- 現況：`FreeCheckup.jsx` 仍有 **3595 行**。5 個 tab 已抽，僅剩 TradeTab inline。
- 動作：
  - 抽 `_freeCheckup/tabs/TradeTab.jsx`（比照其他 tab 的 props 注入合約）。
  - 把 `useAppRuntimeComposer` 呼叫包成 `useFreeCheckupRuntime()` hook。
  - L2965 / L4745 `<style>` 字面字串（`wb-hero-grid` / `.wb-card`）**留在容器**，不可外移。
- 驗收：FreeCheckup.jsx ≤ 1500 行；560/390/380 RWD 清單 + `e2e/freecheckup-card.spec.ts` 全綠。

### D2. 其他 Context value 審視
- `PortfolioPanelsContext`、`CheckupModeContext` 確認 value `useMemo`，避免父層 re-render 連帶 cascade。
- `useSignalRealtimeInvalidation` 檢查 channel subscribe/unsubscribe 對稱。

### C5. routePrefetch 節流檢查
- 確認 `prefetchHighTrafficRoutes` 在 `requestIdleCallback` 內逐個 import，低階手機不塞滿主執行緒；超過 3 個目標時改 `setTimeout` 排隊。

---

## P1 — 大檔案拆分（>40KB 頁面）

剩餘流量高的單檔（行數）：

| 檔案 | 行數 | 拆分手法 |
|---|---|---|
| `Checkout.tsx` | 1351 | 抽 `_checkout/`：plan-summary、payment-method-picker、consent-block、submit-flow hook |
| `admin/Signals.tsx` | 1328 | 抽 filter bar、bulk-action toolbar、row 元件 |
| `company/KnowledgeBase.tsx` | 1130 | 已有 `knowledge-base/` 子資料夾，繼續搬主檔的 tab/table |
| `Index.tsx` | 1049 | hero 以外 section 已 lazy；剩 SEO / structured-data 區可抽 `_index/` |
| `Pricing.tsx` | 1028 | 抽 plan-card、faq、comparison-table 子元件 |
| `company/Revenue.tsx` | 968 | 抽圖表與表格區塊（圖表已用 PerfMetricsChart 模式可參考）|

策略：每檔抽 2–4 個子元件 + 1 個 data hook，控制在 ≤ 600 行容器；流量序：`Checkout → Pricing → Index → 其餘 admin/company`。

---

## P2 — Edge Function 共用層全面套用

骨架已就位（`_shared/cors.ts` `edgeLogger.ts` `supabaseClients.ts`），但 71 個 functions 只有 `knowledge-backtest` 真的接上。

- E1. 分批遷移到 `withLogging` + `serviceClient/userClient`，每批 5–8 個 function：
  1. **低風險批**：checkup-* 唯讀類（calendar、predict-events、sparkline、telemetry、twse、news、research...）
  2. **背景排程批**：*-cron、daily-*、expire-*、cleanup-*、knowledge-* scheduler
  3. **金流 / webhook 批**（最後做，需配 supabase--test_edge_functions 跑 happy path）：ecpay-callback、acpay-*、confirm-*、line-webhook、process-refund
- E2. 統一 `function_logs` 寫入（`/company/function-logs` UI 已有）。
- E3. 列出沒測試的 fn，金流/webhook 類補 happy-path test。

---

## P3 — 型別 / 死碼 / CI 加固

- F1. `ts-prune` 或 `knip` 一次性掃 dead exports，特別審 `src/checkup/lib/index.js` 的 re-export 大集合（會拖 tree-shake）。
- F2. `any` 收斂：目前計數工具未抓到（檔內 cast 多為 `as any`），改用 `rg "as any" src` 一次列表，優先處理 hooks 與 lib 層。
- G1. 確認 `.github/workflows/freecheckup-rwd.yml` 是 required check（阻擋 merge）。
- G2. 為已拆 AuthContext 補 re-render counter 測試作為 baseline（D1 已完成，但缺迴歸防線）。
- G3. Edge function 失敗自動寫 `function_logs` 的 vitest mock 測試。

---

## P4 — 觀測 / 回饋迴路（補完）

- H2. `/company/perf-metrics` 已有路由分位數欄；確認 P75 LCP 目標 < 2.5s 的 SLO 警示（超過時 dashboard 標紅）。
- H3 延伸. `scripts/bundle-snapshot.mjs` 已能擋 PR；加 GitHub Actions step 在 PR comment 貼 diff 表，提升可見度。

---

## 建議實作順序

1. **A1**（TradeTab + runtime hook）— 解最大維護債，影響日常開發速度
2. **D2 + C5**（小修，半天可完成）
3. **P1 大檔拆分** 流量序：Checkout → Pricing → Index
4. **P2 Edge 遷移** 低風險批先行
5. **P3 死碼 / 型別**
6. **P2 金流批 + P4 觀測補完**

要先開哪一塊？建議從 **A1**（FreeCheckup 收尾）或 **P1-Checkout** 起手。
