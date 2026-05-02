
# Phase 4：收盤分析韌性強化

延續 Phase 3 的「不為了拆而拆」原則。`useDailyAnalysisWorkflow.js`（512 行）內 12+ 個 component-scope 變數彼此糾纏，**強行抽 hook 反而更難維護**——這部分跳過。本階段只做「會直接降低使用者損失機率」的三項實質優化。

## 三項變更

### 1. JSON 解析韌性（主分析 + 盲測）
**問題**：目前 line 263 / 317 / 327 用裸 `JSON.parse` 解析 AI 輸出。AI 在 maxTokens=8192 偶爾截斷，會導致整個 BRAIN_UPDATE 解析失敗、fallback 觸發第三次計費呼叫。

**改法**：建立 `src/checkup/lib/aiJsonRepair.js`（前端版，邏輯對齊 `supabase/functions/_shared/jsonRepair.ts`），提供 `parseJsonArray(text)` 與 `parseJsonObject(text)`：
- `parseJsonArray`：移除 ```` ```json ```` 圍欄 → 找平衡 `[...]` → 截斷修補（蒐集完整的 `{...}`）
- `parseJsonObject`：移除圍欄 → 找平衡 `{...}` → 嘗試直接 parse

`useDailyAnalysisWorkflow.js` 三處替換：
- line 260-265 盲測 `blindPredictions` 解析 → `parseJsonArray`
- line 315-322 `EVENT_ASSESSMENTS` 解析 → `parseJsonArray`
- line 324-342 `BRAIN_UPDATE` 解析 → `parseJsonObject`

**收益**：BRAIN_UPDATE 截斷時還能取回部分 rules，不必觸發 fallback（省一次 AI 呼叫 ≈ 8-15 秒 + 不浪費配額）。

### 2. blindStatus 遙測欄位
**問題**：盲測失敗會被 `catch` 吞掉只 console.warn，`blindPredictions = []`，使「準確率 0%」無法分辨是「真的全錯」還是「盲測根本沒跑」。

**改法**：在 `useDailyAnalysisWorkflow.js` 加 `blindStatus` 區域變數：
```js
let blindStatus = 'ok'  // 'ok' | 'failed' | 'empty' | 'parse_error'
```
在三個分支設值：HTTP 失敗 → `failed`；解析後陣列空 → `empty`；JSON 解析失敗 → `parse_error`。

寫入 `report.meta.blindStatus`（透過 `buildDailyReport` 的 meta 欄位，已存在）。後續 UI 可顯示「盲測未執行」徽章，目前不動 UI（避免溢出風險）。

### 3. save-analysis 韌性
**問題**：line 370-376 `fetch(...).catch(() => {})` 雲端寫入失敗就靜默丟棄。當天分析結果只存在記憶體 + zustand persist，重新整理可能還在但 cross-device 看不到。

**改法**：抽小函式 `persistAnalysisToCloud(report)` 進 `src/checkup/lib/dailyAnalysisRuntime.js`（已存在的 runtime 模組）：
- 嘗試 POST，失敗暫存到 `localStorage['checkup:pendingAnalysis']`（最多 5 筆 ring buffer）
- 在工作流啟動時呼叫一次 `flushPendingAnalyses()` 重送

不加重試輪詢（避免拖累流程），單純「啟動時補送」即可。

## 檔案異動

```text
src/checkup/lib/aiJsonRepair.js                          [NEW]  ~80 lines
src/checkup/lib/__tests__/aiJsonRepair.test.js           [NEW]  ~60 lines, 8 tests
src/checkup/lib/dailyAnalysisRuntime.js                  [EDIT] 加 persistAnalysisToCloud / flushPendingAnalyses
src/checkup/hooks/useDailyAnalysisWorkflow.js            [EDIT] 三處 parse 替換 + blindStatus + 改用 persistAnalysisToCloud
```

## 不做的事（明確聲明）

- **不抽 useDailyAnalysisWorkflow → useCallback 拆分**：12+ 變數依賴會讓函式簽名爆炸，與 Phase 3 跳過 `useCalendarFetch` 同理。
- **不動 UI / JSX**：遵守 FreeCheckup 與 inline rendering 規約。
- **不調 maxTokens**：那是 edge function 的事，且 8192 對 Claude/Gemini 已合理。
- **不動 `fetchCalendarEvents` 5 分鐘 timeout**：使用者明確指示不要改。

## 驗證

- 新增 8 條 unit test 涵蓋：圍欄包裹、平衡括號、截斷陣列、截斷物件、prose 干擾、空字串、純 JSON、巢狀。
- 跑 `bunx vitest run` 確認 725+ 既有測試全綠。
- 不需 e2e，邏輯純函式 + 副作用（localStorage）已被測試覆蓋。

請確認後，切回 default mode 執行。
