# 持倉看板 Phase 2.5 — 決策工作台（最終修正版）

## 補丁內容
在前一版基礎上，修正「今日優先」的全局視角問題，避免被 filter 影響。

## 範圍
僅 `src/pages/FreeCheckup.jsx`。在 Phase 2 卡片化基礎上，加入決策優先排序、Action Banner、視覺權重分層、hover 行為與來源 context。

## 1. 預設排序改為「決策優先」

`sortBy` 預設改為 `decision`，`sortByDecisionPriority` 重寫為四階優先：

```text
priority(h) =
  exit                                → 0
  review                              → 1
  hold + (urgency=now || conflict)    → 2
  hold + urgency=soon                 → 3
  hold + thesis=weakening             → 4
  其他 (normal hold + intact)         → 5
```

同優先級內次序：urgency(now>soon>monitor) → confidence(high>med>low) → 市值 desc。

## 2. 視覺權重分層

| 狀態 | 左 border | 背景 | 陰影 | 角標 |
|---|---|---|---|---|
| exit | 4px `C.down` | `alpha(C.down,'08')` | `0 1px 3px alpha(C.down,'12')` | 🔴 出場 |
| review | 4px `C.amber` | `alpha(C.amber,'06')` | `0 1px 2px alpha(C.amber,'10')` | 🟡 檢查 |
| hold+alert | 2px `C.amber` 60% | `alpha(C.amber,'02')` | 無 | 無 |
| normal | 無 | 無 | 無 | 無 |

## 3. Action Banner（具體標的 + 全局今日優先）

Filter bar 上方插入 banner，兩個區塊：

**3a. 🎯 今日優先（全局視角，不受 filter 影響）**

```text
🎯 今日優先處理
[#1 名稱 代碼 │ exit │ +12% ] [#2 ...] [#3 ...]
```

- 來源：`globalPriorityList`（從**未經 filter** 的 `holdings` 全量計算 priority，取前 3 檔）
- 點擊 mini-card：`setActiveCode(code)` + `setDrawerSource({ type: 'priority-global', label: '🎯 今日優先（全局）' })` + 開 drawer
- 即使套用 filter，這 3 張 mini-card 仍維持全局最優先 3 檔不變

**3b. 分類概覽（局部 + filter 連動）**

```text
⛔ 建議出場 2 檔  →  2330, 3443
⚠ 需要處理 5 檔  →  2317, 1101, 2454...（顯示前 3 個 code 連結）
⏰ 即將到期 3 檔  →  ...
```

- 計數來源：`holdings` 全量（不受 filter 影響）
- 每個 code 連結：點擊 → 開 drawer + `drawerSource = { type: 'category', key: 'exit', label: '⛔ 建議出場' }`
- 區塊右側 `→` 按鈕：套用對應 quick filter（保留搜尋字串、清除其他 chip）
- 三項皆 0 時顯示「✅ 持倉狀態良好，無待處理決策」
- Mobile 改水平捲動

## 4. Drawer 來源 Context

新增 state：
- `drawerSource: { type, key?, label } | null`
  - `type: 'priority-global'` → 來源清單為 `globalPriorityList`
  - `type: 'category'`，`key: 'exit' | 'review' | 'upcoming'` → 來源清單為對應全量 category 子集
  - `type: 'list'`（預設，從卡片列表點入）→ 來源清單為 `filteredSortedList`
  - `type: 'search'`（搜尋有結果 + 從列表點入）→ 同上，但 label 顯示「（篩選結果）」

`sourceList` 由 `useMemo` 依 `drawerSource.type` 推導。

**Drawer header 三層**：

```text
┌──────────────────────────────────────────────────┐
│ ‹ 返回[來源]                                  ✕  │
│ 來自：🎯 今日優先（全局）                        │
│ ‹ 上一檔   名稱 代碼  ( i / N )   下一檔 ›       │
└──────────────────────────────────────────────────┘
```

- 第一行「返回[來源]」：點擊關閉 drawer，並依 source type scroll 回對應位置
  - priority-global / category → scroll 到 Action Banner
  - list / search → 還原 `scrollPosRef`（沿用現有邏輯）
- 第二行 label：
  - `🎯 今日優先（全局）`
  - `⛔ 建議出場`、`⚠ 需要處理`、`⏰ 即將到期`
  - `📋 持倉列表`、`📋 持倉列表（篩選結果）`
- 第三行：上一檔／下一檔依 `sourceList` 環狀循環，`(i/N)` 為相對於 sourceList 位置

## 5. activeCode 安全處理（沿用 + 擴充）

`useEffect` 監聽 `[sourceList, activeCode, drawerOpen]`：
- `drawerOpen && sourceList.findIndex(h => h.code === activeCode) === -1`：
  - `sourceList.length === 0` → 關 drawer + 清 source
  - `> 0` → fallback 到 `sourceList[0].code`

## 6. Hover / Focus

```css
transition: transform 200ms ease, box-shadow 200ms ease;
hover/focus: translateY(-1px) scale(1.005) + shadow（依狀態色調）
```

- exit hover shadow：`alpha(C.down,'15')`
- review hover shadow：`alpha(C.amber,'12')`
- 一般 hover shadow：`alpha(C.text,'08')`
- focus 加 `outline 2px alpha(C.text,'20')`
- mobile 不啟用 scale，保留 focus
- 遵守 `prefers-reduced-motion: reduce`

## 7. 不在範圍

- buildDecision 邏輯修改
- Drawer 內容區塊調整（Phase 2 已定）
- 新 actionType 或 DB schema
- filter / sort 持久化

## 8. 變更檔案

`src/pages/FreeCheckup.jsx`：
- 新增 `globalPriorityList`、`exitList`、`reviewList`、`upcomingList` 四個 `useMemo`（皆從 `holdings` 全量算）
- 新增 `drawerSource` state + `sourceList` 推導
- `sortByDecisionPriority` 重寫四階
- 預設 `sortBy = 'decision'`
- 插入 Action Banner（priority + category 兩區）
- Drawer header 改三層 + 來源 label
- activeCode fallback 改用 `sourceList`
- 卡片 inline style 改 hover transform + shadow

## 9. 驗證

1. 預設排序 exit 在最上、normal 在最下
2. Action Banner 顯示 🎯 今日優先 3 張 mini-card + 分類概覽含具體 code 連結
3. **套用 filter 例如 thesis=intact 後，🎯 今日優先 3 張 mini-card 仍為全局最優先 3 檔（不變）**
4. 從 mini-card 進 drawer：header 顯示「🎯 今日優先（全局）」，左右切換僅在這 3 檔內循環
5. 從分類「⛔ 建議出場 → 2330」進 drawer：header「⛔ 建議出場」，左右切換僅在 exit 子集內循環
6. 從卡片列表點入：header「📋 持倉列表」或「📋 持倉列表（篩選結果）」，左右循環走 `filteredSortedList`
7. 點 header「‹ 返回」：drawer 關閉，scroll 回 banner 或原列表位置
8. filter 將 activeCode 過濾掉時自動 fallback 或關閉
9. hover 卡片有上浮 + 狀態色陰影
10. 截圖 desktop + mobile 兩種 viewport
