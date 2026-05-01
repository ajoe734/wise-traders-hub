# Free Checkup 架構重構計畫

## 進度

- ✅ 階段 1A：前端所有 edge 呼叫收斂到 `callEdge`
- ✅ 階段 1B：建立 `_shared/withCheckup.ts` middleware + 16 函式 CORS 統一
- ✅ 階段 2：FreeCheckup tab 拆分（pages/HoldingsPage/DailyPage/EventsPage/...）
- ✅ 階段 3B：建立 `src/checkup/lib/syncEngine.js`，統一 localStorage↔checkup-brain 雙寫；`usePortfolioPersistence` 與 `useCloudSync` 改為委派 syncEngine
- ⏳ 階段 3A：FreeCheckup useState → zustand stores（**待拆分執行**）

---

## 階段 3A 拆分計畫（下一輪）

3A 範圍涵蓋 13 個 portfolio useState + 6+ 個 hook 的 ref-sync + dependency 改寫，>1500 行 diff，**不能一次推完**。建議子階段順序：

### 3A.1 portfolioStore 接通（最低風險）
- 將 `activePortfolioId / viewMode / portfolios / portfolioSwitching` 從 `usePortfolioManagement` 內的 useState 換成 `usePortfolioStore`
- 移除 `activePortfolioIdRef / viewModeRef / portfoliosRef / portfolioSetterRef` —— 改用 `usePortfolioStore.getState()` 在非 React 環境取值
- 影響檔：`usePortfolioManagement.js`, `useAppRuntimeSyncRefs.js`, `useAppRuntimeComposer.js`
- QA：切 portfolio < 200ms、demo/實名隔離不破

### 3A.2 holdingsStore 接通
- `holdings / tradeLog / targets / fundamentals / watchlist / analystReports / reportRefreshMeta / holdingDossiers / reversalConditions`
- 影響檔：`FreeCheckup.jsx`（13 個 useState 中的 9 個）+ `usePortfolioPersistence.js`（依賴改 selector）
- QA：T+0 即時 PnL 計算未變、`bunx playwright test e2e/freecheckup-card.spec.ts` 全綠

### 3A.3 brainStore / eventStore / reportsStore 接通
- `strategyBrain / brainValidation / newsEvents / analysisHistory / dailyReport / researchHistory`
- 影響檔：`FreeCheckup.jsx` + `useEventLifecycleSync.js` + `useEventReviewWorkflow.js`
- QA：事件預測、收盤分析、研究歷史均能正確顯示

### 3A.4 移除 useAppRuntimeCoreLifecycle 中所有 setter prop
- composer 從「協調 30 個 setState」變成「協調 6 個 store action」
- 影響檔：`useAppRuntimeCoreLifecycle.js`, `useAppRuntimeComposer.js`（1142 行重構）
- QA：完整 regression（mobile RWD checklist + i18n scanner + e2e）

---

## 風險與回滾

| 階段 | 風險 | 回滾 |
|---|---|---|
| 3B | syncEngine action mapping 漏掉某個 slice → 該 slice 不雙寫 | git revert syncEngine.js + usePortfolioPersistence.js + useCloudSync.js |
| 3A.1 | portfolioStore 訂閱觸發整頁重渲 | 把 usePortfolioStore selector 拆到最細粒度，靠 React DevTools profiler 驗證 |
| 3A.2 | dependency 漏抓 store update → useEffect 不重跑 | 每個 useEffect 改完都跑 e2e + i18n 掃描 |
| 3A.3 | brain validation cases 計算邏輯誤動 → 統計面板亂 | 保留 `useBrainStore.addValidationCase` 的 dedupe 邏輯，不改業務算式 |
| 3A.4 | composer 重構是高風險最後一步，建議單獨 PR + 全 QA | 完整 revert 三檔 |

---

## 交付節奏建議

- 階段 1：✅ 已交付
- 階段 2：✅ 已交付
- 階段 3B：✅ 已交付（本輪）
- 階段 3A.1～3A.4：建議一輪一子階段，每子階段獨立 commit + 完整 QA
