

# 持倉看板 Bug 總檢報告 — 為什麼看不到是枝裕和風格

## 根本原因（最大 Bug）

**`FreeCheckup.jsx` 完全沒有使用我們修改過的元件。** 持倉分頁（`tab==="holdings"`，第 1410-1685 行）是用 **277 行內聯 JSX** 自己渲染的，完全繞過了 `HoldingsPanel`、`HoldingsTable`、`HoldingRow` 這些我們花時間美化的元件。

換句話說，我們修改的檔案根本沒有被 `/free-checkup` 頁面引用。用戶看到的是舊版 Bloomberg 風格，不是是枝裕和。

---

## 完整 Bug 清單

### Bug 1（致命）：Hero 卡片仍用漸層 + 粗體
- **位置**：`FreeCheckup.jsx` 第 1417-1428 行
- **問題**：`linear-gradient`、`border`、`fontWeight:700`、百分比用 `pill` 背景色塊
- **是枝裕和應有**：`alpha(heroColor, '06')` 純色底、無邊框、`fontWeight:500`、百分比純文字 `opacity:0.7`

### Bug 2（致命）：Sub-metrics 用卡片邊框包裝
- **位置**：第 1434-1443 行
- **問題**：`background:C.subtle`、`border:1px solid C.border`、`fontWeight:600`、`fontSize:18`
- **是枝裕和應有**：無背景、無邊框、`fontWeight:500`、`fontSize:13`、用 `space-around` 排列

### Bug 3（致命）：Top5 仍用 conic-gradient 圓環 + emoji
- **位置**：第 1445-1461 行
- **問題**：`📊` emoji、`conic-gradient` 圓餅圖、5 種 `topColors`、`fontWeight:700`
- **是枝裕和應有**：純文字排名數字 + 2px 高進度條、第 1 名 `C.teal` 其餘灰階

### Bug 4（致命）：勝負摘要用色帶 + emoji + mini bars
- **位置**：第 1463-1501 行
- **問題**：`📈`/`📉`、`borderLeft:3px solid`、`fontWeight:700`、進度條
- **是枝裕和應有**：純文字列表、無色帶、無 emoji、`fontWeight:500`、`borderBottom` 極淡分隔

### Bug 5（嚴重）：反轉追蹤區塊未套用美學
- **位置**：第 1503-1583 行
- **問題**：`borderLeft:3px solid ${C.amber}88`、`fontWeight:500` 混 `fontWeight:600`、`C.card` 背景
- **應修正**：降為 `1px borderLeft`、統一 `fontWeight:400-500`

### Bug 6（中等）：排序按鈕仍用舊風格
- **位置**：第 1586-1597 行
- **問題**：`C.blue` 高亮、`fontWeight:500` 偏重
- **應修正**：選中態用 `C.textSec`、未選用 `C.textMute`、`fontWeight:400`

### Bug 7（中等）：持股明細行仍混用舊元素
- **位置**：第 1599-1684 行
- **問題**：`badge()` 函數用彩色背景 pill（權證/ETF）、產業名用 `IND_COLOR` 上色（第 1633 行）、目標價進度條用 3 種顏色判斷、`fontWeight:600`
- **部分已修**：`muteTag` 已統一 period/position 標籤（之前修的）
- **仍未修**：`badge` pill、產業色、目標價條色彩

### Bug 8（中等）：Header 區域 fontWeight 過重
- **位置**：第 1346 行
- **問題**：「持倉看板」標題 `fontSize:22, fontWeight:700`
- **應修正**：`fontWeight:500`

### Bug 9（小）：今日事件提醒用 emoji + 色帶
- **位置**：第 1381-1388 行
- **問題**：`📅` emoji、`borderLeft:2px solid`
- **應修正**：去 emoji、降為 `1px`

---

## 修正計畫

**核心策略**：不抽元件（避免大規模重構），直接在 `FreeCheckup.jsx` 的 holdings 分頁內聯程式碼中套用是枝裕和風格。改動範圍第 1330-1685 行。

### 改動 1：Hero 卡片（第 1412-1431 行）
- 移除 `heroGrad`、`heroBorder`
- 改為 `background: alpha(heroColor, '06')`、無 `border`
- `fontWeight: 700` → `500`
- 百分比移除 pill，改純文字 + `opacity: 0.7`

### 改動 2：Sub-metrics（第 1434-1443 行）
- 移除卡片背景、邊框
- 改為 `display: flex, justifyContent: space-around`
- `fontWeight: 600` → `500`、`fontSize: 18` → `13`

### 改動 3：Top5（第 1445-1461 行）
- 移除 `📊`、conic-gradient 圓環、`topColors`
- 改為排名數字 + 名稱 + 百分比 + 2px 進度條
- 與 `HoldingsPanel.jsx` 的 `Top5Holdings` 視覺一致

### 改動 4：勝負摘要（第 1463-1501 行）
- 移除 `📈`/`📉`、`borderLeft:3px`、進度條
- 改為純文字列表 + `borderBottom: alpha(textMute, '06')`

### 改動 5：反轉追蹤（第 1503-1583 行）
- `borderLeft: 3px` → `1px`、alpha 降至 `'20'`
- 統一 `fontWeight: 400`

### 改動 6：排序按鈕（第 1586-1597 行）
- 選中：`C.textSec`、無背景
- 未選：`C.textMute`、`fontWeight: 400`

### 改動 7：持股行（第 1599-1684 行）
- `badge` 的權證/ETF 改為 `muteTag` 風格
- 產業名去色（`IND_COLOR` → `C.textMute`）
- 目標價進度條統一灰色 + teal
- `fontWeight: 600` → `500`

### 改動 8：Header（第 1346, 1371, 1374 行）
- 標題 `fontWeight: 700` → `500`
- 損益 `fontWeight: 700` → `500`
- 百分比 `fontWeight: 600` → `400`

### 改動 9：今日事件（第 1381-1388 行）
- 去 `📅` emoji
- `borderLeft: 2px` → `1px`

## 涉及檔案

| 檔案 | 改動 |
|------|------|
| `src/pages/FreeCheckup.jsx` | 第 1330-1685 行的 holdings 分頁渲染 |

不動資料流、計算邏輯、store、其他分頁。

