## Phase 3：架構清潔（行事曆 + 事件分析）

延續 Phase 1+2，目標把 `FreeCheckup.jsx`（7166 行）中與 calendar/event 相關的「**邏輯函式**」拉出去，只留 state、ref、UI render。**不動 inline JSX**，遵守既有 inline-rendering memory。

---

### 範圍（僅邏輯抽離，零 UI 改動）

#### A. 新檔：`src/checkup/lib/calendarSync.js`
從 FreeCheckup.jsx 搬出純函式：

- `computeCalendarStableId(label, date, type)` — 目前在 `syncCalendarToNews` 內 inline，也在 server `checkup-calendar/index.ts` 有一份。**這份在 client 端共用** + server 那份保留（runtime 隔離），但加註解互相 reference。
- `mergeCalendarEvents(existingEvents, newEvents, holdingCodes)` — 行 950-964 的 dedupe + sort + 標 _holdingCodes。
- `mergeCalendarToNewsEvents(prevNewsEvents, calEvents)` — 行 1019-末段 `setNewsEvents` 的純合併邏輯（input：prev + calEvents，output：merged array）。

→ FreeCheckup.jsx 改成：
```js
import { mergeCalendarToNewsEvents, mergeCalendarEvents, computeCalendarStableId } from '@/checkup/lib/calendarSync';

const syncCalendarToNews = (calEvents) => {
  setNewsEvents(prev => mergeCalendarToNewsEvents(prev, calEvents));
};
```

#### B. 新檔：`src/checkup/hooks/useCalendarFetch.js`
封裝整個 `fetchCalendarEvents`（行 853-998，約 145 行）。

簽章：
```js
const { fetchCalendarEvents, calendarLoading, calendarLastError, calendarAutoStatus, calendarLastDebug } 
  = useCalendarFetch({ 
      isDemo, callEdge, save, simulateSteps,
      onEventsUpdate, onSyncToNews,
      pushUpdateLog, flashCalendarStatus, recordCalendarError, classifyError, mapFallbackCodeToStatus,
      resetGuardRef, setCalendarRetry, DEMO_CALENDAR, CALENDAR_DEDUP_MS,
    });
```

把這些 ref/state 也搬進 hook：
- `calendarInflightKeyRef`、`calendarAbortRef`、`calendarLastFetchRef`
- `calendarLoading`、`calendarAutoStatus`、`calendarLastDebug`
- 保留在 FreeCheckup 的：`calendarEvents`、`calendarRetry`、`calendarLastError`（因為 UI 直接讀）

FreeCheckup.jsx 用 hook 取代 inline 的 1 個函式 + 3 個 ref + 3 個 state。

#### C. 預測快取 helper：`src/checkup/lib/eventPredictionCache.js`
從 FreeCheckup.jsx 行 1461 附近抽 `predictEvent` 的 cache lookup / save：
- `getPredictionCache(stableId)` — 讀 `prediction-cache-${stableId}`
- `setPredictionCache(stableId, payload)` — 寫入帶 timestamp
- `isPredictionCacheValid(entry, ttlMs = 24*60*60*1000)` — TTL 檢查

不改呼叫 LLM 的部分，只把 cache I/O 收斂。

#### D. 單元測試
新增 `src/checkup/lib/__tests__/calendarSync.test.js`：
- `computeCalendarStableId` 各種日期格式（YYYY/MM/DD、YYYY/MM月、YYYY Q1）
- `mergeCalendarToNewsEvents`：
  - 新事件全新 → 建立 with stableId
  - 既有 calendar 事件被新 AI 結果覆蓋 → status/pred 不被降級
  - userReviewed（有 actual 或 lessons）→ pred/predReason 不被覆寫
  - manual source 事件不受影響

---

### 不在這次範圍

- ❌ FreeCheckup.jsx 的 JSX render 區塊（受 inline-rendering memory 保護）
- ❌ `predictEvent` 主函式抽離（行 1461 周邊跟 UI loading state 緊耦合，動到 risk 高）
- ❌ Phase 1+2 follow-up（warrant-sync parser、cron）→ 另外處理

---

### 變更檔案清單

| 檔案 | 動作 | 行數 |
|---|---|---|
| `src/checkup/lib/calendarSync.js` | 新增 | ~120 |
| `src/checkup/hooks/useCalendarFetch.js` | 新增 | ~160 |
| `src/checkup/lib/eventPredictionCache.js` | 新增 | ~40 |
| `src/checkup/lib/__tests__/calendarSync.test.js` | 新增 | ~100 |
| `src/pages/FreeCheckup.jsx` | 邏輯刪除 + import 替換 | -~250 / +~10 |

預期 FreeCheckup.jsx：7166 → ~6920 行。

---

### 風險

- **唯一風險**：把 ref/state 搬進 hook 後，外部讀取時機要對齊。對策：
  - `calendarLoading` / `calendarAutoStatus` 從 hook 回傳 → UI 直接綁
  - `fetchCalendarEvents` 由 hook 回傳，FreeCheckup 只 call，guard 仍透過 `resetGuardRef` 傳入
  - 三個 ref 內部化後，外部的 `calendarAbortRef.current?.abort()` call site（搜整個檔）若有外部使用→ 改透過 hook 暴露 `abortCalendarFetch()` 方法

實作時會 `rg "calendarAbortRef|calendarInflightKeyRef|calendarLastFetchRef" src/` 確認只在 fetchCalendarEvents 內被引用，再決定是否需要暴露 abort 方法。

---

### 驗收

1. `bunx vitest run src/checkup/lib/__tests__/calendarSync.test.js` 全綠
2. 行事曆刷新（手動 + 自動）行為不變：dedup、abort、30s 節流、demo 模式都正常
3. 事件分析 stableId 合併行為與 Phase 1 一致（status 不降級、userReviewed 保護）
4. FreeCheckup.jsx 行數下降 ≥ 200

確認後即執行。
