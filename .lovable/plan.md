

# 持倉資料庫（Notion 模式）— Phase 1 Plan（最終版）

## 範圍
僅 `src/pages/FreeCheckup.jsx` 持股清單區塊。遵守 inline rendering 原則，不抽元件、不改 DB schema、不新 hook。

## 1. Filter Bar（搜尋 + 多條件篩選 + Active Tags）

清單上方新增 sticky filter bar，三層結構：

**第一層：搜尋框**
- placeholder「搜尋代碼／名稱／題材／策略」，即時過濾
- 比對來源：`code`、`name`、`STOCK_META[code].strategy`、`STOCK_META[code].theme`
- 大小寫不敏感、空白 trim、多關鍵字以空白分隔（AND）
- 右側顯示 ✕ 一鍵清除

**第二層：Filter chips（多選）**
| 維度 | 選項 |
|---|---|
| Decision | hold / review / exit |
| Thesis | intact / weakening / broken |
| Urgency | now / soon / monitor |
| Conflict | 有衝突 / 無衝突 |
| 損益 | 獲利 / 虧損 / 平盤 |
| 題材 | 動態取自 `STOCK_META[code].strategy` 去重 |

維度內 OR、維度間 AND；選中 chip 用 `alpha(C.text,'12')` 背景。

**第三層：Active Filters 狀態列**（新增）
- 當搜尋字串非空 或 任一 chip 被選中 時顯示
- 每個 active 條件渲染為可關閉 tag：
  - 搜尋：`🔍 "關鍵字" ✕`（點 ✕ 清空搜尋）
  - chip：`Decision: exit ✕`（點 ✕ 取消該選項）
- 右側顯示 `已篩選 X / Y 檔`（即時更新，搜尋與 filter 同時作用）
- 最右側「清除全部」連結（搜尋 + chips 一起清空）
- 全部無條件時整列隱藏，避免佔空間

state 存 `useState`，本階段不持久化。

## 2. 排序強化

把現有 4 個排序按鈕擴成 7 個，支援 asc↔desc：

`市值 / 損益 / 報酬% / urgency / confidence / 更新時間 / 決策優先`

- 點同一鍵切方向，按鈕右側顯示 `↑ ↓`
- urgency：`now=3 > soon=2 > monitor=1`
- confidence：`high > medium > low`
- 更新時間：`dec.lastUpdatedAt || max(events.occurredAt) || h.priceUpdatedAt`

## 3. Detail Drawer + 上一檔／下一檔 + 安全處理

點擊任一列開啟右側 drawer（`src/components/ui/sheet.tsx`，`side="right"`，width ~480px，米白底）：

```
┌── Sheet ────────────────────────────────────────────┐
│ ‹ 上一檔   名稱 代碼 ( i / N )   下一檔 ›   ✕        │
│ 數量·成本·市價·市值·損益·%                          │
│ ───────────────────────────────────────             │
│ 【Decision Box】 actionText / thesis / confidence / urgency
│ 【Thesis】 進場理由（INIT_THESIS or override note）
│ 【Events Timeline】 該檔 open + 最近 5 個 resolved
│ 【筆記 / Exit Cue】可編輯 textarea
│ 【目標價清單】 reuse INIT_TARGETS
└─────────────────────────────────────────────────────┘
```

**狀態設計**：
- 不儲存 holding 物件，只存 `activeCode` (string) + `drawerOpen` (boolean)
- drawer 內容由 `filteredSortedList.find(h => h.code === activeCode)` 即時取得

**activeCode 安全處理**（新增）：
- 在 render 前用 `useMemo` 計算 `activeIndex = filteredSortedList.findIndex(h => h.code === activeCode)`
- `useEffect` 監聽 `[filteredSortedList, activeCode, drawerOpen]`：
  - 若 `drawerOpen && activeIndex === -1`（filter 把目前檔過濾掉）：
    - 若 `filteredSortedList.length === 0` → 自動關閉 drawer
    - 若 `> 0` → fallback 到 `filteredSortedList[0].code`，drawer 維持開啟
- drawer 內所有讀取一律走 `filteredSortedList[activeIndex]`，並先做 null guard，杜絕 undefined render

**上一檔／下一檔**：
- 取目前 `activeIndex`，上一檔 `(idx - 1 + len) % len`，下一檔 `(idx + 1) % len`（環狀）
- 列表只剩 1 檔時兩按鈕 disabled
- 依目前篩選後、排序後的列表順序，不是原始資料
- header 顯示 `(i / N)` 即時反映目前位置

**鍵盤快捷鍵**：
- drawer 開啟時 `←` / `→` 切換（`Esc` 由 Sheet 內建關閉）
- 切換／關閉時若有未儲存的筆記/exitCue，先呼叫 `setUserOverrides` + cloud sync

**Drawer 關閉維持 scroll 位置**（新增）：
- 點列開啟前先 `scrollPosRef.current = window.scrollY`
- 為避免 Sheet 預設行為改動 `<body>` overflow 觸發跳動：drawer 開啟時不鎖 body scroll（Sheet 本身為 fixed overlay，不必鎖）
- drawer `onOpenChange(false)` 時：先清 `activeCode`，下一個 frame 用 `requestAnimationFrame(() => window.scrollTo({ top: scrollPosRef.current, behavior: 'instant' }))` 還原
- 若使用者在 drawer 開啟期間有滾動列表（drawer 為 overlay 不阻擋背景滾動），以最後一次 scrollY 為準（每次背景 scroll 更新 ref）

## 4. 列本身微調（最小幅度）

- 點擊整列：開 drawer 並設 `activeCode = h.code`、記錄 `scrollPosRef`
- 第一行右側補 chevron `›`
- 既有 exit / review border 與背景**保留不動**，Decision UI 視覺不擴充

## 5. 不在範圍

- Decision UI 視覺擴充（Phase 2）
- Notion 風格 column header 表格化（Phase 3）
- DB schema 新欄位（thesis、exitCue 仍走 `userOverrides` JSON）
- filter / sort 狀態持久化到 cloud sync

## 變更檔案

- `src/pages/FreeCheckup.jsx`：搜尋框、filter chips、active tags 列、排序擴充、列點擊開 drawer、drawer + 上下切換 + 鍵盤 + 安全 fallback + scroll 還原（全部 inline）

## 驗證

1. 搜尋「台積」→ 列表只剩 2330；Active tags 顯示 `🔍 "台積" ✕`，已篩選數即時更新
2. 同時開搜尋 + `decision=exit`：active tags 同時顯示兩個 tag，點任一 ✕ 各別關閉
3. drawer 開啟 2330 後，搜尋改成「3443」→ activeCode 不在清單，drawer 自動 fallback 或關閉，無 undefined error
4. drawer 開啟後關閉，scroll 位置與點擊前一致（不跳頂）
5. 鍵盤 `←` / `→` 切換正常，header `(i/N)` 同步更新
6. 截圖 (a) filter+search+active tags bar (b) drawer 開啟含上下切換 header

