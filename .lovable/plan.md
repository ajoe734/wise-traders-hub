

# 持倉看板全面 Bug 清掃報告

## 問題總覽

持倉分頁（tab==="holdings"）的核心區域已套用是枝裕和風格，但仍有殘留問題。此外，**觀察清單（watchlist）分頁完全沒有套用**，仍是舊版 Bloomberg 風格。以下逐項列出。

---

## Bug 清單

### A. 持倉分頁殘留問題（5 項）

| # | 位置 | 問題 | 修正 |
|---|------|------|------|
| A1 | 第 1340 行 | DEMO 標籤 `fontWeight:600`、LINE 標籤 `fontWeight:600` | 降為 `500` |
| A2 | 第 1343 行 | saved 文字 `fontWeight:600` | 降為 `500` |
| A3 | 第 1398 行 | 選中分頁標籤 `fontWeight:600` | 降為 `500` |
| A4 | 第 1494 行 | 反轉追蹤的 `borderBottom` 用 `C.borderSub`（舊變數，非 alpha 淡化） | 改為 `alpha(C.textMute,'06')` |
| A5 | 第 1607 行 | alert 標籤 `fontWeight:600` | 降為 `500` |

### B. 觀察清單分頁未套用風格（6 項）

| # | 位置 | 問題 | 修正 |
|---|------|------|------|
| B1 | 第 1669 行 | 空狀態 emoji `👀` | 移除，改純文字 |
| B2 | 第 1683 行 | 卡片用 `...card` 展開（含 `background:C.card, border:1px solid C.border`），且交替用 `bgTints` 三色背景 | 移除 card 展開，改為 `borderBottom` 分隔 + 無背景 |
| B3 | 第 1686 行 | 股名 `fontSize:18, fontWeight:600` | 改 `fontSize:13, fontWeight:500` |
| B4 | 第 1705 行 | 數據值 `fontSize:19, fontWeight:600`，且目標價用 `C.olive`、漲幅用 `C.blue` 多色 | 改 `fontSize:13, fontWeight:500`，色彩只留損益 |
| B5 | 第 1691 行 | 「獲利中/虧損中」pill 背景 badge | 改為純文字 + 淡色，無背景 |
| B6 | 第 1712 行 | 進度條用 `linear-gradient`（全檔最後一個漸層） | 改為 `C.teal` 純色 + 2px 高度 |

### C. 全域共用常數污染（2 項）

| # | 位置 | 問題 | 修正 |
|---|------|------|------|
| C1 | 第 117 行 | `card` 常數帶 `background:C.card, border:1px solid C.border`，所有分頁的 `...card` 展開都帶邊框 | 持倉/觀察清單不再使用 `...card`；其他分頁保持（避免波及） |
| C2 | 第 118 行 | `lbl` 常數 `fontWeight:600` | 持倉/觀察清單區域不使用 `lbl`，改用內聯 `fontWeight:400` |

---

## 修正計畫

### 改動 1：持倉分頁 fontWeight 殘留（A1-A3, A5）
- 第 1340、1341、1343 行：`fontWeight:600` → `500`
- 第 1398 行：選中 tab `fontWeight:600` → `500`
- 第 1607 行：alert `fontWeight:600` → `500`

### 改動 2：反轉追蹤 borderBottom（A4）
- 第 1494 行：`C.borderSub` → `alpha(C.textMute,'06')`

### 改動 3：觀察清單全面套用是枝裕和（B1-B6）
- 移除 `👀` emoji
- 整個 watchlist 區（1666-1718 行）重寫為：
  - 無 `card` 包裝，改用 `padding + borderBottom` 分隔
  - 股名 `13px/500`、代碼 `10px/400`
  - 數據用 `flex` 水平排列、`fontSize:12`、`fontWeight:400`
  - 損益純文字帶色、無 pill badge
  - 目標價進度條 2px 純 `C.teal`
  - 移除 `linear-gradient`

## 涉及檔案

| 檔案 | 改動 |
|------|------|
| `src/pages/FreeCheckup.jsx` | 第 1340-1343（header 標籤）、1398（tab）、1494（反轉）、1607（alert）、1666-1718（觀察清單） |

不動資料流、計算邏輯、store、其他分頁（events/daily/trade/log/news 不動）。

