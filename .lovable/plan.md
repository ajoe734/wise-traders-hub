

# Decision System v6 — 實作計畫（含硬性規則）

## 硬性規則（寫入 holdingEventUtils.js 檔頭註釋，所有開發者必讀）

| 規則 | 內容 |
|------|------|
| **R1** | 禁止直接使用 `event.status` 判斷 open/closed。一律透過 `isEventOpen()` 或 `getEffectiveStatus()`。違反視為 bug。 |
| **R2** | `buildDecisionFingerprint()` 排序固定：先 `occurredAt` 升序 → 再 `id` 字串升序。確保穩定 hash。 |
| **R3** | Dedupe merge 統一實作於 `mergeEvents()`：保留 `existing.id`、summary/evidence 取最新 `updatedAt`、severity 取較高值、impact 衝突時標記 `_hasMergeConflict` 不覆蓋。 |
| **R4** | `category` / `impact` / `severity` / `occurredAt` 建立後不可變。修正需建新 event 並將舊 event resolved。透過 `validateEventMutation()` 攔截。 |
| **R5** | `effectiveUntil` 過期不回寫 `status`。expired 僅為 `getEffectiveStatus(event, now)` 的讀取時計算結果。 |

---

## 實作步驟

### Step 1: 常數定義 — `constants.js` (+30 行)

新增：
- `EVENT_CATEGORIES`, `IMPACT_TYPES_DECISION`, `SEVERITY_LEVELS`, `ACTION_TYPES`
- `IMMUTABLE_EVENT_FIELDS = ['category', 'impact', 'severity', 'occurredAt']`
- `FRESHNESS_RULES`（依 category 分類的 aging/stale 天數）
- `ACTION_TEMPLATES`（hold/review/exit 固定模板文字）
- `PORTFOLIO_STORAGE_FIELDS` 新增 `{ suffix: 'user-overrides-v1', alias: 'userOverrides', ... }`

### Step 2: 核心邏輯 — `src/checkup/lib/holdingEventUtils.js` (新建, ~200 行)

純函數庫，無 side effect：

- `getEffectiveStatus(event, now)` — 唯一 status 判斷入口（R1, R5）
- `isEventOpen(event, now)` — 包裝 getEffectiveStatus
- `deriveThesisState(openEvents)` — break→broken, weaken→weakening, else intact
- `derivePositionState(thesisState)` — exit/warning/holding
- `deriveUrgency(positionState, openEvents, now)` — 多維（state + severity + reviewAt）
- `detectConflict(openEvents, override)` — impact 方向衝突 + override 不一致
- `deriveConfidence(openEvents, hasConflict)` — 資料品質導向（R4 限制條件）
- `buildAction(positionState, openEvents, override, now)` — `{actionType, actionText}` 固定模板
- `buildDecision(code, allEvents, userOverrides, now)` — 主入口，含 `_debug`（R6）
- `buildDecisionFingerprint(openEvents)` — R2 固定排序 hash
- `isDuplicateEvent(existing, incoming)` — category + codes + 24h
- `mergeEvents(existing, incoming)` — R3 策略
- `validateAiEvent(event)` — 必填驗證
- `validateEventMutation(original, updates)` — R4 不可變攔截
- `deriveFreshness(event, now)` — category 查表
- `sortByDecisionPriority(decisions)` — conflict > urgency > severity > updatedAt
- `toLegacyDisplayStatus(event, now)` — 行事曆 UI adapter

### Step 3: 事件正規化擴充 — `eventUtils.js` (~25 行修改)

`normalizeEventRecord` 新增欄位推導（不影響現有欄位）：
- `category` ← `catalystType || inferCatalystType() || 'catalyst'`
- `impact` ← existing || `inferImpact()` || `'neutral'`
- `severity` ← existing || `'medium'`
- `occurredAt` ← `eventDate || createdAt`
- `relatedCodes` ← `getEventStockCodes(event)`
- `summary` ← `detail || ''`
- `evidence` ← existing || `''`
- `source` ← existing || `'demo'`

### Step 4: Store 擴充 — `eventStore.js` (+15 行)

新增 `userOverrides: {}` state + `setUserOverride` / `removeUserOverride` / `setUserOverrides`

### Step 5: Hook 整合 — `useEvents.js` (+30 行)

新增 `decisionsMap` 的 `useMemo` 計算：對所有持倉 code 呼叫 `buildDecision()`。匯出 `decisionsMap` 與 `getDecision(code)`。

### Step 6: Helper 匯出 — `useAppRuntimeHelperCatalog.js` (+10 行)

匯出 holdingEventUtils 核心函數。

### Step 7: UI 整合 — `FreeCheckup.jsx` (~250 行)

- 持股列表每列加 badge：thesis（intact 無/weakening 琥珀/broken 紅）、action（hold/review/exit）、urgency 圓點、conflict ⚠️、confidence ⓘ
- 排序改用 `sortByDecisionPriority`
- 展開行加 Decision Box：該做什麼 / 為什麼 / 觀察期限 / open events 列表 / override 按鈕
- 設定區加 Debug toggle（`window.__DECISION_DEBUG`）

---

## 驗收標準

1. 同一檔股票在 open event、override、conflict、stale event 四種情境下 decision 輸出正確
2. 新增程式碼不得直接用 `event.status` 判斷 open/closed
3. `source === 'demo'` 不參與 decision 推導
4. `reversal-v1` 不被 `buildDecision()` 讀取

---

## 檔案清單

| 檔案 | 類型 | 預估行數 |
|------|------|----------|
| `src/checkup/lib/holdingEventUtils.js` | 新建 | +200 |
| `src/checkup/constants.js` | 修改 | +30 |
| `src/checkup/lib/eventUtils.js` | 修改 | +25 |
| `src/checkup/stores/eventStore.js` | 修改 | +15 |
| `src/checkup/hooks/useEvents.js` | 修改 | +30 |
| `src/checkup/hooks/useAppRuntimeHelperCatalog.js` | 修改 | +10 |
| `src/pages/FreeCheckup.jsx` | 修改 | +250 |

不變更：AI Edge Functions、雲端同步、資料庫、行事曆/事件分析 UI、reversal-v1。

