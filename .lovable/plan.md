# Free Checkup 架構重構計畫

按你選的優先順序，分三階段執行。每階段都可獨立交付、不阻塞下一階段。

---

## 階段 1：Edge 層統一（呼叫 + middleware）

**目標**：根除 401 反覆出現、消除 18 個 checkup-* 函式各自實作認證／配額／CORS 的重複碼。

### 1A. 前端：所有 edge 呼叫收斂到 `callEdge`

掃描到的散落點（共 7 處 raw fetch + 1 處 supabase.functions.invoke）：

| 檔案 | 行 | 函式 | 處理 |
|---|---|---|---|
| `FreeCheckup.jsx` | 858 | checkup-calendar | 改 callEdge |
| `FreeCheckup.jsx` | 1446 | checkup-sparkline | 改 callEdge |
| `FreeCheckup.jsx` | 1784, 1892 | checkup-twse | 改 callEdge |
| `FreeCheckup.jsx` | 2022, 2137 | checkup-analyze | 改 callEdge |
| `FreeCheckup.jsx` | 2469 | checkup-parse | 改 callEdge |
| `FreeCheckup.jsx` | 1284 | checkup-predict-events | 已是 callEdge ✓ |

附帶動作：
- 補齊 `EDGE_SCHEMAS` 中缺漏的 schema（calendar / sparkline / twse / analyze / parse）
- 移除 `aiAuthHeaders()` 函式與 `SUPABASE_FN_BASE` 常數（callEdge 已內建）
- 對配額相關呼叫，統一在 `callEdge` 攔截 429 → 觸發 `QuotaModal`（目前散在各 try/catch）

### 1B. 後端：建立 `_shared/withCheckup.ts` middleware

封裝所有 checkup-* 函式共用的 boilerplate：

```ts
// _shared/withCheckup.ts
export function withCheckup(handler, opts: {
  cors?: boolean,           // 預設 true
  auth?: 'required' | 'optional' | 'none',  // 預設 required
  quota?: false | string,   // false 不扣配額；字串為 kind ('analysis' / 'parse' / ...)
  schema?: ZodSchema,       // 入參驗證
}) {
  return async (req: Request) => {
    // 1. CORS preflight
    // 2. JWT 驗證 → 注入 ctx.userId
    // 3. quota 扣除 → 失敗回 429 + snapshot
    // 4. schema validate → 失敗回 400 VALIDATION_ERROR
    // 5. 呼叫 handler(req, ctx)
    // 6. 統一錯誤格式 + CORS headers
  };
}
```

每個 checkup 函式從 ~50 行 boilerplate 縮成：
```ts
Deno.serve(withCheckup(async (req, ctx) => {
  // 純業務邏輯
  return { result: ... };
}, { quota: 'analysis', schema: AnalyzeSchema }));
```

涵蓋的 18 個函式分類：
- 需 auth + quota：analyze / parse / research / predict-events / brain（部分 action）/ research-extract
- 需 auth 不扣 quota：calendar / institutional / mops-* / analyst-reports / report / telemetry / knowledge / sparkline / twse
- 公開：ecpay-callback（webhook）/ create-checkup-* （另有付款驗證）

**驗收**：
- 用 `supabase--curl_edge_functions` 測 `checkup-predict-events` 三種情境：無 token → 401、配額用盡 → 429 + quota body、正常 → 200
- `bunx playwright test e2e/freecheckup-card.spec.ts` 全綠
- `rg "fetch\(.*functions/v1|aiAuthHeaders|supabase.functions.invoke" src/pages/FreeCheckup.jsx` 應 0 命中

---

## 階段 2：FreeCheckup.jsx 拆分

**目標**：6800+ 行單檔拆成 5 個 ~1000-1300 行的子檔，按 tab 邊界切。

**前置動作**：解除記憶 `mem://architecture/checkup/inline-rendering-audit` 的禁拆規則，改寫成「inline JSX 風格保留，但檔案邊界按 tab 切」。

### 拆分結構

```text
src/pages/FreeCheckup/
  index.jsx                  # 主殼：路由、tab 切換、shell layout（~600行）
  hooks/
    useCheckupRuntime.js     # 收口 useAppRuntimeCoreLifecycle 對外 API
    useQuotaGate.js          # 配額檢查 + Modal 觸發
  tabs/
    HoldingsTab.jsx          # 持倉看板 + Hero（~1200行，含 wb-card 巨集）
    DailyTab.jsx             # 每日分析（~1100行）
    EventsTab.jsx            # 事件日曆 + 預測（~1000行）
    ResearchTab.jsx          # 個股研究（~900行）
    LogTab.jsx               # 交易日誌（~800行）
  shared/
    QuotaModal.jsx
    QuotaMeter.jsx
    styles.js                # 共用 alpha / typography token
```

### 拆分原則
- inline JSX 區塊整段平移，**不抽元件、不改邏輯**
- 共用的 `<style>` 媒體查詢區塊（≤560/≤390/≤380）跟著對應 tab 走
- 跨 tab 共用的 state 留在 `index.jsx`，透過 props 下傳（不引入 Context，避免 re-render 黑洞）

### 強制 QA（不打折）
1. 拆分前：截圖 baseline（560/390/380 三斷點 × 5 個 tab = 15 張）
2. 拆分後：截圖比對，pixel diff 容忍 < 1%
3. `bun run scripts/check-freecheckup-rwd.mjs` 通過
4. `bunx vitest run src/test/unit/freecheckup-mobile-card-overflow.test.ts` 通過
5. `bunx vitest run src/test/unit/freecheckup-i18n.test.ts` 通過
6. `bunx playwright test e2e/freecheckup-card.spec.ts` 通過

### 記憶更新
- 改寫 `mem://architecture/checkup/inline-rendering-audit` → 拆檔後新規則
- 更新 `mem://qa/checkup/freecheckup-mobile-regression-checklist` 路徑指向新檔結構

---

## 階段 3：前端狀態 + 雲端同步重構

**目標**：FreeCheckup useState 改用既有 Zustand stores、雙寫雲端同步邏輯集中到 syncEngine。

### 3A. Zustand stores 接上

目前 stores 已建好但未使用：`holdingsStore / eventStore / brainStore / marketStore / portfolioStore / reportsStore`

執行：
1. 把 `FreeCheckup.jsx` 的 `useState` (holdings/events/brain/...) 換成 store selectors
2. 移除 `useAppRuntimeCoreLifecycle` 中 10+ 個 ref 同步（`activePortfolioIdRef` / `viewModeRef` / `portfoliosRef` / `portfolioSetterRef` / `bootRuntimeRef` / `cloudSyncStateRef` / ...）— 這些都是 useState→ref 的補丁，stores 訂閱後不再需要
3. `useAppRuntimeCoreLifecycle` 從「協調 30 個 setState」變成「協調 6 個 store action」

### 3B. 雲端同步集中到 `syncEngine`

新建 `src/checkup/lib/syncEngine.js`：

```js
// 單一入口處理：localStorage ↔ checkup_storage 雙寫
export const syncEngine = {
  load(portfolioId, userId) { ... },     // 啟動時：cloud > local 衝突解
  save(portfolioId, slice, data) { ... },// debounce 300ms，雙寫
  isolateDemoMode(userId) { ... },       // sentinel UUID 隔離邏輯
  getStatus() { ... },                   // pending/synced/error
};
```

把目前散在 `usePortfolioPersistence` / `useAppLifecycleRuntimeComposer` / `loadPortfolioSnapshot` / `savePortfolioData` / `readSyncAt` / `writeSyncAt` / `shouldAdoptCloudHoldings` 的邏輯統整。

**驗收**：
- 切換 Demo / 實名模式不串資料（既有測試）
- 多 portfolio 切換 < 200ms（目前因 ref sync 約 500ms）
- 無痕模式 → 登入 → 資料正確 adopt cloud

---

## 風險與回滾

| 階段 | 風險 | 回滾 |
|---|---|---|
| 1 | callEdge 缺 schema 導致誤擋 → silent flag 已可繞 | git revert 單檔 |
| 2 | 拆檔後 import 循環 | 嚴格遵守 index→tabs→shared 單向 |
| 3 | store 訂閱不當引發 re-render 風暴 | React DevTools profiler 把關，逐 store 切 |

---

## 交付節奏建議

- 階段 1：1 個 PR（前後端各一 commit），1 天
- 階段 2：3-5 個 PR（每 tab 一個），分 3-5 天，每 PR 跑完 QA 才合
- 階段 3：2 個 PR（stores 接上 / syncEngine），分 2-3 天

如同意，開工順序：**階段 1A → 1B → 2 → 3A → 3B**。
