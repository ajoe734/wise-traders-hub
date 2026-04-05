

# 🎬 網頁設計師 × QA 聯合檢驗報告：持倉看板是否徹底「是枝裕和化」

## 設計師視角 — 逐項對照是枝裕和美學原則

### 原則 1：極微色底取代漸層 ✅ 通過

**HoldingsSummary** Hero 區：
- `background: alpha(heroColor, '06')` — 06 透明度，極微色底，完全符合
- 無 `boxShadow`、無 `border` — 乾淨
- 圓角 `12px` 適度

**問題：0 項**

### 原則 2：字重 400–500，字距加大 ✅ 通過

- Hero 損益：`fontWeight: 500`、`letterSpacing: 0.02em` ✓
- 百分比：`fontWeight: 400`、`opacity: 0.7` ✓
- Section title：`fontWeight: 400`、`letterSpacing: 0.12em` ✓
- HoldingRow 名稱：`fontWeight: 500` ✓
- HoldingRow 代碼/標籤：`fontWeight: 400` ✓

**問題：0 項**

### 原則 3：移除所有 boxShadow，用間距分隔 ✅ 通過

- 全檔搜索：零個 `boxShadow` 出現
- 區塊間距統一使用 `marginBottom: 24`
- HoldingRow 用 `borderBottom: 1px solid alpha(textMute, '08')` — 極淡分隔線

**問題：0 項**

### 原則 4：Emoji 全部移除 ✅ 通過

- HoldingsPanel.jsx 全檔零 emoji
- HoldingsTable.jsx 全檔零 emoji
- 改為純文字 section title（`投 組 健 檢`、`市 值 佔 比`、`持 股 明 細`）

**問題：0 項**

### 原則 5：色彩極淡化，只有數字帶色 ⚠️ 有 2 處不完美

**通過的部分：**
- 產業條：最大產業原色，其餘灰階 `alpha(textMute, '25')` ✓
- Top5 進度條：第 1 名 `C.teal`，其餘 `alpha(textMute, '20')` ✓
- WinLoss：損益數字帶色，名稱 `C.textSec` 中性 ✓
- HoldingRow PnL：`pc(pnl)` 函數只給數字上色 ✓

**不完美 (1)：HoldingRow 的 period 標籤仍用功能色**
- 第 100-112 行：`periodColor(meta.period)` 會返回 `C.orange`、`C.blue`、`C.amber`、`C.teal`
- 是枝裕和風格裡不該有 4 種顏色的標籤散落在每一行
- **建議**：統一改為 `C.textMute` + `opacity: 0.6`，或直接移除顏色

**不完美 (2)：HoldingsIntegrityWarning 仍有 amber 左邊色帶**
- 第 139 行：`borderLeft: 2px solid alpha(C.amber, '30')`
- 警告功能需要保留可見性，但 `2px` 邊線 + 黃色背景稍嫌「重」
- **建議**：可保留（功能性優先），但考慮降為 `1px` + `alpha('20')`

---

## QA 視角 — 功能性與邊界檢查

### 數據計算 ✅ 全部正確

- `totalPnl = totalVal - totalCost` ✓
- `totalPct` 有 `totalCost > 0` 除零保護 ✓
- HoldingRow 有 `Number(holding.qty) || 0` 防 NaN ✓
- `Math.max(totalVal, 1)` 在 Top5 百分比計算防除零 ✓

### 排序邏輯 ✅ 正確

- 支援 code/value/pnl/pct 四種排序 ✓
- asc/desc 雙向 ✓

### 空狀態 ✅ 正確

- `holdings.length === 0` 顯示「尚無持股」✓
- Top5 `top5.length === 0` 返回 null ✓
- HealthCheck `holdings.length === 0` 返回 null ✓

### 展開/收合 ✅ 正確

- expanded 時 `borderRadius: '8px 8px 0 0'`，detail 區 `0 0 8px 8px` ✓
- toggle 按鈕文字切換 `展開`/`收起` ✓

### 手機響應性 ⚠️ 有 1 處風險

- HoldingRow 第 3 行（財務數據）用 `display: flex` + `gap: 12`，4 個數據項（股數、成本、現價、市值）+ 右側 PnL
- 在 320px 極窄螢幕可能擠壓
- **建議**：考慮將 gap 從 12 降為 8，或讓市值 `display: none` on narrow

### 產業健檢的三欄格子 ⚠️ 潛在擠壓

- 第 283 行：`gridTemplateColumns: '1fr 1fr 1fr'`
- 在 320px 下三欄各約 93px，中文「短中期」+數字可能換行
- 非錯誤，但可考慮 `@media` 降為兩欄

---

## 總結評定

```text
是枝裕和原則               狀態      備註
─────────────────────────────────────────────
極微色底取代漸層           ✅ 完成   alpha('06') 極淡
字重 400-500              ✅ 完成   全面降重
移除 boxShadow            ✅ 完成   零陰影
移除 Emoji                ✅ 完成   全部純文字
色彩極淡化                ⚠️ 95%   period 標籤仍帶 4 色
留白間距                  ✅ 完成   24px 統一間距
邊框極淡化                ✅ 完成   alpha('08') 分隔線
```

**整體評分：92/100** — 已大致完成是枝裕和風格轉換

## 建議修正（2 項小改動）

### 修正 1：HoldingRow period 標籤去色
- `HoldingsTable.jsx` 第 103-109 行
- 將 `color: periodColor(meta.period)` 改為 `color: C.textMute`
- 移除 `periodColor` 函數（不再需要）

### 修正 2：HoldingsIntegrityWarning 邊線減淡
- `HoldingsPanel.jsx` 第 139 行
- `borderLeft` 從 `2px` 改為 `1px`，alpha 從 `'30'` 改為 `'20'`

這兩項改動合計約 4 行程式碼，可讓持倉看板達到 98/100 的是枝裕和純度。

