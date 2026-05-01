# 階段 3A.3：Brain / NewsEvents / Reports / Research → Zustand

把 `useAppRuntime.js` 中剩下的 8 個 `useState` 替換成 `eventStore` / `brainStore` / `reportsStore` 的 selectors，與 3A.1（portfolio）、3A.2（holdings）保持同樣風格：**只動 setter 來源、不動 runtimeState/runtimeSetters 物件形狀**，下游 composer / lifecycle / workflow hooks 完全無感。

## 目標 slice 對應

| 現有 useState | 改用 store | store 內現況 |
|---|---|---|
| `newsEvents` | `useEventStore` | 已有 `setNewsEvents`，需把預設從 `[]` 改成 `null`（保留「未 hydrate」哨兵） |
| `strategyBrain` | `useBrainStore` | 已有 `setStrategyBrain`，預設已是 `null` ✅ |
| `brainValidation` | `useBrainStore` | 預設 `{version:1,cases:[]}` 需改用 `createEmptyBrainValidationStore()` |
| `analysisHistory` | `useReportsStore` | 預設從 `[]` 改 `null` |
| `dailyReport` | `useReportsStore` | 已 `null` ✅ |
| `researchHistory` | `useReportsStore` | 預設從 `[]` 改 `null` |
| `analyzing` / `analyzeStep` / `researching` | `useReportsStore` | 已存在對應 setter ✅ |

> 不遷移 `ready` / `cloudSync` / `portfolioNotes`：屬於 runtime/UI 暫態，留在 useAppRuntime 即可（與 3A.2 對齊）。

## 變更步驟

### 1. `src/checkup/stores/eventStore.js`
- `newsEvents` 初值 `[]` → `null`
- `addEvent / updateEvent / deleteEvent / getEventsByStatus / getUrgentCount / getTodayAlertSummary` 全部加 `asArr` 保護（`(state.newsEvents ?? [])`），避免 hydrate 前崩潰
- `setNewsEvents` 走 `makeSetter` 模式以支援 `setX(prev => next)`（與 3A.2 對齊）
- 加 `hydrateInitial(partial)`：僅在仍為初值時 patch（與 portfolio/holdings store 同 pattern）

### 2. `src/checkup/stores/brainStore.js`
- `import { createEmptyBrainValidationStore } from '../lib/brainRuntime.js'`
- `brainValidation` 初值改成 `createEmptyBrainValidationStore()`
- `setStrategyBrain / setBrainValidation` 改 `makeSetter` 以支援 updater function
- 加 `hydrateInitial`

### 3. `src/checkup/stores/reportsStore.js`
- `analysisHistory` / `researchHistory` 初值 `[]` → `null`
- `addAnalysis / deleteAnalysis / getLatestAnalysis / getAnalysisCount` 用 `asArr` 包覆
- 所有重點 setter（`setAnalysisHistory`, `setDailyReport`, `setResearchHistory`, `setAnalyzing`, `setAnalyzeStep`, `setResearching`, `setReportRefreshMeta`）改 `makeSetter`
- 加 `hydrateInitial`

### 4. `src/checkup/hooks/useAppRuntime.js`
把這些 `useState` 換成 store selectors：

```js
// events
const newsEvents = useEventStore((s) => s.newsEvents)
const setNewsEvents = useEventStore((s) => s.setNewsEvents)

// brain
const strategyBrain = useBrainStore((s) => s.strategyBrain)
const setStrategyBrain = useBrainStore((s) => s.setStrategyBrain)
const brainValidation = useBrainStore((s) => s.brainValidation)
const setBrainValidation = useBrainStore((s) => s.setBrainValidation)

// reports / research / async flags
const analysisHistory  = useReportsStore((s) => s.analysisHistory)
const setAnalysisHistory = useReportsStore((s) => s.setAnalysisHistory)
const dailyReport      = useReportsStore((s) => s.dailyReport)
const setDailyReport   = useReportsStore((s) => s.setDailyReport)
const researchHistory  = useReportsStore((s) => s.researchHistory)
const setResearchHistory = useReportsStore((s) => s.setResearchHistory)
const analyzing        = useReportsStore((s) => s.analyzing)
const setAnalyzing     = useReportsStore((s) => s.setAnalyzing)
const analyzeStep      = useReportsStore((s) => s.analyzeStep)
const setAnalyzeStep   = useReportsStore((s) => s.setAnalyzeStep)
const researching      = useReportsStore((s) => s.researching)
const setResearching   = useReportsStore((s) => s.setResearching)
```

`runtimeState` / `runtimeSetters` 物件鍵維持不變，所以 `useAppRuntimeCoreLifecycle` / `useAppRuntimeWorkflows` / `useAppRuntimeComposer` / `usePortfolioBootstrap` / `usePortfolioPersistence` 全部 0 修改。

### 5. 驗證
- `bunx vitest run src/test/unit/freecheckup-i18n.test.ts src/test/unit/freecheckup-mobile-card-overflow.test.ts src/test/unit/1.3-holding-math.test.ts`
- `bun run scripts/check-freecheckup-i18n.mjs`
- `bunx playwright test e2e/freecheckup-card.spec.ts`（依 mem://qa/checkup/freecheckup-mobile-regression-checklist 規則）
- 手動心智檢查：
  - 切換 portfolio → `setNewsEvents(null)` 重 hydrate 不爆
  - Demo mode（非 OWNER_PORTFOLIO_ID）下 syncEngine.setContext 仍正確 gating 雲端寫入（3A.1 已驗證，本階段不改）
  - 分析中 `analyzing=true` 切到其他頁仍維持（store 是全域單例，反而更穩）

## 風險與緩解

- **全域 store 副作用**：`analyzing/researching` 變成跨 hook 共享 → 若未來開多個 portfolio 視圖會互相影響。目前架構單實例使用，無風險；3A.4 重構 composer 時再評估是否要加 portfolio scope。
- **預設值改成 null**：所有讀取點目前已用 `?? []` 或 `Array.isArray()` 守，已搜過 `usePortfolioPersistence` / `useAppRuntimePortfolioDerivedData` 沒有裸取。store 內 selector 也補 `asArr`，雙重保險。
- **brainValidation 形狀**：必須走 `createEmptyBrainValidationStore()`，不要硬寫 `{cases:[]}`，避免 schema 漂移。

## 不在本階段範圍

- `ready` / `cloudSync` / `portfolioNotes`：屬 runtime 暫態，3A.4 統一處理
- `useAppRuntimeComposer` 拆掉 setter prop drilling：留待 **3A.4**
- `reviewingEvent / reviewForm / showAddEvent / calendarMonth` 等 UI 暫態已在 `useAppShellUiState` / `eventStore` 內各自管理，本階段不動

## 完成定義

- `useAppRuntime.js` 不再 import `createEmptyBrainValidationStore`、不再有上表 8 個 `useState`
- 三個 store 的初值與 setter 行為對齊 holdingsStore 規範（null 哨兵 + functional setter + hydrateInitial）
- 上述測試與 RWD 截圖全綠
- mem://core 中「不准偷懶」清單中的 RWD 三斷點截圖（560/390/380）保留並附在回報