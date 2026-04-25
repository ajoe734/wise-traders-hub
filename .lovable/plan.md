## /free-checkup → Decision Workbench 改造

### 設計鎖定
- **配色**：本頁破例採單一橘紅 `#FF4D1F`（漲跌皆同色），背景暖白 `#F5F3EF`，深黑 `#0A0A0A` 為次強調
- **Hero**：橫向 2 欄，移除每日語句
- **Cards**：所有卡統一高度 320px；Feature card 僅靠 `span 2` + 黑底凸顯
- **Sparkline**：真實 5 日收盤
- **Detail Panel**：點選卡片才顯示，桌面浮現 420px 第二欄

---

### Step 1 — 後端 Sparkline API
新建 `supabase/functions/checkup-sparkline/index.ts`：
- 輸入 `POST { codes: string[] }`（≤30）
- 並行 fetch TWSE/TPEX 近 5 個交易日收盤（沿用 `twse-proxy`/`tpex-proxy` 模式，含 3s timeout per code）
- 結果寫 `checkup_storage`，key=`sparkline_${code}_${YYYYMMDD}`，TTL 24h
- 回傳 `{ [code]: number[] }`，失敗檔回 `[]`
- CORS + zod 驗證
- 用 `supabase--curl_edge_functions` 驗證

### Step 2 — 配色 Tokens 隔離
在 `src/pages/FreeCheckup.jsx` 頂層新增 `WB` token：
```js
const WB = { bg:'#F5F3EF', surface:'#FFFFFF', ink:'#0A0A0A', inkMute:'#6B6862', hair:'#E8E6E1', accent:'#FF4D1F' };
const wbColor = (n) => n >= 0 ? WB.accent : WB.ink;
```
全頁 ROI / 損益顏色改用 `wbColor`，不污染其他頁面。

### Step 3 — Hero 區重構
左側：`PORTFOLIO` 小標 + Today's P&L（96px 大字）+ inline 22px ROI；右側：`Market TAIWAN ●` + `Update YYYY/MM/DD HH:mm`；底部 4 欄 KPI（Total Value / Holdings / Win Rate / Cash）。移除每日語句、Daily Report 標籤。

### Step 4 — Action Priority 重構
單行 inline 文字流：`ACTION PRIORITY ●` + 3 檔 `代號 名稱 / 事件描述` + 右側圓形 `→`。移除框、背景、徽章。

### Step 5 — Card Wall 統一
所有卡 `minHeight:320px`、ROI `52px`；新增 inline `<Sparkline />` SVG（30 行）；Feature card 維持 `span 2 + 黑底 + 白字 + 橘紅 ROI`，內部 5 層結構；Normal card 同結構但白底；最後一格 `+ Add Watchlist` 虛線。

### Step 6 — Detail Panel（點選才顯示）
寬度 420px、頂部 `< > ×` 導覽、DECISION 黑底盒（橘紅 EXIT + 三行白字）、URGENCY 改為 `●●●●○` 五點、EVENT TIMELINE 加 `TOMORROW` 橘紅標籤、OVERRIDE 區塊（Mark as Hold + 編輯 icon）。

### Step 7 — 底部狀態列
左：`{N} Holdings`；右：`Sort by: Priority ▾` + 卡/列視圖切換 icon。

---

### 影響範圍
| 檔案 | 變動 |
|---|---|
| `supabase/functions/checkup-sparkline/index.ts` | **新建** |
| `src/pages/FreeCheckup.jsx` | 大幅重構 Hero / Priority / Cards / Detail / Footer |
| 其他檔案 | **不變動** |

### 不會做的事
- 不調整其他頁面紅綠色系
- 不抽出新 React 元件（維持 inline 渲染慣例）
- 不改 Detail Panel 資料來源邏輯，只改視覺
