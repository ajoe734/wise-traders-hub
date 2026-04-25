## 持倉看板優化計畫（單色橘紅 + 灰階版）

### 設計原則
**配色憲法（嚴格三色，不再混入第四色）**
- `#EC662D` accent 橘 — **唯一強調色**，僅用於：正報酬數字、urgency dot、accent 卡左側細條
- `#1E1E1D` ink 黑 — 主數字（總市值、部位數）、卡片標題
- `#6B6862` inkMute 灰 — 次文字、負報酬數字、metadata
- `#9B968D` inkLight 淺灰 — placeholder、單位、disabled
- `#EFEDE8` paper / `#FFFFFF` surface — 背景兩層

**負值處理（核心決策）**：負報酬使用 **灰色 `#6B6862` + 上箭頭 `↓`**，正報酬使用 **橘色 `#EC662D` + 上箭頭 `↑`**。靠**符號 + 顏色濃淡 + 字重**製造對比，而不是紅綠對撞。視覺結果：賺錢的部位「跳出來」，賠錢的部位「沉下去」，符合「該關注什麼」的決策直覺。

**層級靠字重，不靠色塊**
- Hero 數字：48px / weight 400 / tabular-nums
- 卡片 ROI：32–40px / weight 500
- 標題：15px / weight 500
- Metadata：11px / weight 400 / letter-spacing 0.12em

**留白與細線**
- 圓角統一 `4px`（極小，幾乎方形）
- 分隔線一律 `1px solid rgba(30,30,29,0.08)`，禁用陰影、漸層、邊框色塊
- 卡片內距 `16px`，卡片間距 `12px`

---

### Phase 1 — 重寫設計 Token（單色化）

**檔案**：`src/checkup/components/holdings/holdingsTokens.js`

修改：
1. 移除 `up: '#C0392B'` 與 `down: '#2E7D5B'`
2. 新增 `gain: '#EC662D'`（= accent）與 `loss: '#6B6862'`（= inkMute）
3. 重寫 `valueColor(value)`：正回傳 `gain`、負回傳 `loss`、零回傳 `inkLight`
4. 新增 `valueWeight(value)`：正回傳 `500`、負回傳 `400`（讓賺錢字更重）
5. 新增 `valueArrow(value)`：正回傳 `'↑'`、負回傳 `'↓'`、零回傳 `''`

這會自動套用到所有已使用 `valueColor` 的元件（HoldingHero、HoldingCard、HoldingDetailPanel、PriorityStrip），無須個別改。

---

### Phase 2 — Wiring：把 Workbench 接到 /free-checkup

目前 `HoldingsWorkbench / HoldingHero / HoldingCard / PriorityStrip / HoldingDetailPanel` 已存在但未匯出、未使用。

**檔案**：`src/checkup/components/holdings/index.js`
- 新增 export：`HoldingsWorkbench`、`HoldingHero`、`HoldingCard`、`PriorityStrip`、`HoldingDetailPanel`

**檔案**：`src/pages/FreeCheckup.jsx`
- 持倉區塊（目前內聯渲染）替換為 `<HoldingsWorkbench>`，傳入 holdings、decisionsMap、stockMeta、todayPnl/Pct
- 保留 Hero 上方既有的「Today's P&L」抬頭與行動列，避免破壞 plan.md 已決議的 13 項精修
- **不抽出新元件、不動 sparkline 抓取邏輯**（遵守 inline-rendering-audit 記憶）

---

### Phase 3 — HoldingHero 視覺強化

**檔案**：`src/checkup/components/holdings/HoldingHero.jsx`

1. 主要 KPI 從 4 欄改為 **3 欄 + 1 個次級資訊行**：
   - 主欄：總市值（48px ink 黑）
   - 次欄：累積報酬率（36px、橘或灰）
   - 末欄：今日損益（24px、橘或灰）
   - 底部一行 11px metadata：`成本 ◦ 部位數 ◦ 最後同步 HH:MM`
2. 報酬率前置 `↑` / `↓` 箭頭符號（11px、與數字同色）
3. 移除欄間直線分隔，改用大量留白（左 padding 32px）

---

### Phase 4 — Card Wall 卡片精修

**檔案**：`src/checkup/components/holdings/HoldingCard.jsx`

1. **ink 變體（首位卡）**：黑底、ROI 用 `paper #EFEDE8` 顯示（不用橘），讓首位卡靠「反白」吸睛而非顏色
2. **accent 變體**：白底 + 左側 2px 橘條，ROI 用橘色，其餘文字 ink 黑
3. **plain 變體**：白底 1px hair 細框，ROI 用橘（正）或灰（負）
4. Sparkline 統一 60×20px，stroke 1px：
   - ink 卡用 `paper` 色
   - 其他卡用 `inkLight`（不用橘，避免搶 ROI）
5. Tags 改 filled chip：`#F4F2EE` 背景，無框，padding 4px 8px
6. 底部資料條：`TODAY ↑1.2%` ｜ `VALUE NT$ 320,000`，1px 直線分隔

---

### Phase 5 — Action Priority Strip

**檔案**：`src/checkup/components/holdings/PriorityStrip.jsx`

1. 列表式呈現（不用卡片），每列高度 56px
2. 結構：左側 8px 橘 dot（urgency=high）/ 灰 dot（medium）/ 空（low），中間「代號 名稱」+「事件描述」雙行，右側 28px 圓形細框箭頭按鈕
3. 點擊 → 滾動到該持倉卡片並 highlight 1.2 秒（橘色光暈 0.15 透明度）

---

### Phase 6 — Detail Panel

**檔案**：`src/checkup/components/holdings/HoldingDetailPanel.jsx`

1. 主 ROI 數字改 ink 黑（48px / 400），下方副行用橘色顯示「未實現損益 ↑NT$12,300」
2. 上漲空間（upside）改用相同的橘 / 灰邏輯
3. 桌面右側固定 380px 寬，行動裝置改用 `<Sheet>` 從底部彈出（已有 sheet 元件）
4. 加入「📝 投資理由」可編輯欄位 + 「⚠️ 改為長抱」按鈕（要求填入原因，寫到 decision log）

---

### Phase 7 — 互動細節

**檔案**：`src/checkup/components/holdings/HoldingsWorkbench.jsx`

1. 鍵盤導航：`J` / `K` 切換選中卡片，`Enter` 開 detail，`Esc` 關閉
2. 選中卡片用 1px 橘色外框（不加陰影、不加背景）
3. Mobile（< 768px）detail 改 Sheet

---

### 不會做（明確排除）
- 不重新引入紅綠配色，即使是「淺紅 / 淺綠」
- 不加陰影、漸層、glassmorphism
- 不抽出新元件（除了已存在的 holdings/* 系列）
- 不動 sparkline 的 edge function（`checkup-sparkline`）
- 不改 `/free-checkup` 路由結構與 zustand store

---

### 預期成果
- **視覺**：通篇只有橘 / 黑 / 灰 / 米白，「賺多少」一眼掃出來，「賠的部位」自動讓位
- **資訊密度**：Hero 一眼掌握三大數字，Priority Strip 列出 top-3 該動的部位，Card Wall 提供 5–10 檔總覽，Detail Panel 深入單檔
- **與證券 APP 區隔**：沒有任何「漲紅跌綠」的庸俗對撞，沒有 K 線、沒有買賣盤口，純粹「決策驅動」的儀表板美學

### 涉及檔案（共 7 支）
1. `src/checkup/components/holdings/holdingsTokens.js`
2. `src/checkup/components/holdings/index.js`
3. `src/checkup/components/holdings/HoldingHero.jsx`
4. `src/checkup/components/holdings/HoldingCard.jsx`
5. `src/checkup/components/holdings/PriorityStrip.jsx`
6. `src/checkup/components/holdings/HoldingDetailPanel.jsx`
7. `src/checkup/components/holdings/HoldingsWorkbench.jsx`
8. `src/pages/FreeCheckup.jsx`（僅替換持倉區塊渲染呼叫）