# /holding-checkup 視覺改版 — 執行進度

規格來源：`.lovable/DESIGN_HANDOFF.md`（2026-07-15，Monocle/Kinfolk/MUJI 編輯設計）

## 已完成

### S1 · 持倉卡 §3.4（本輪真正完工）
- `HoldingCardHeader.tsx`：
  - 卡頭只留 `名稱 代號` + 檢視/出場徽章 + 產業 tag
  - 權證支援：`instrument==='warrant'` 或字母開頭代號 → 虛線框 `權證 · 到期 X 月`；`≤1 月` 轉 accent
  - HOLD 不渲染徽章 ✅
  - **移除**：股數 `× N 股`、策略 tag、教學徽章、回報鈕
  - **移除**：可見 sparkline（保留 hidden `.wb-spark` 加 `data-spark-*` 契約，`data-spark-relocated="drawer-4.2"` 標註歸屬）
- `HoldingCard.tsx`：不再傳 `onReportMeta` 給 header（drawer §4 承接）
- 過時測試已刪：
  - `__tests__/HoldingCardHeader.derived.test.tsx`
  - `__tests__/HoldingCardHeader.tip.test.tsx`
  - `__tests__/HoldingCardHeader.perf.test.tsx`
  - `e2e/freecheckup-tip-badge.spec.ts`
  - `e2e/freecheckup-sparkline-width-parity.spec.ts`
  - `e2e/freecheckup-sparkline-roi-mode-parity.spec.ts`
- `playwright.config.ts`：移除 4 個對應 project（tip-badge + 3 個 sparkline-width）
- Ret/PriceTrack/Footer（前輪已完成）：`<ReturnBar>` + `<PriceTrack>` + 中文一行 footer

### 前輪已完成（承接無異動）
- `HoldingCardReturn.tsx` → 使用 `<ReturnBar>`（±40% 尺規、▸ 破表）
- `HoldingCardPriceTrack.tsx` → 使用 `<PriceTrack>`，`decText` 已刪
- `HoldingCardFooter.tsx` → `今日 X ｜ 市值 Y` 單列
- Hero §3.1 / 今日待辦 §3.2 → 前批已對齊

---

## 待辦（依用戶決定：全部依序做完）

### 批次 A · 抽屜 §4（已完成視覺層＋結構重寫，✅）
`HoldingsDetailPanel.tsx` 1163 → 750 行，10 區塊按規格重排：
- **刪除**：`MiniChartsRow` / `ComparisonCharts` / `WeightDonut`（甜甜圈）／`PriceAxisChart` / `RangeChart` 舊 4 圖框、黑底 DECISION 盒、急迫度五點、反向 TARGET 紅條、`SHARE MODE`、RETURN/TARGET/THESIS/NEXT EVENT 英文小標、`showCharts`/`showRange`/`showCost`/`showTargetBar` prefs
- **新增**：
  - `<PriceAxis>`：一條 1px 髮絲軸、成本 灰刻度 + 目標 accent 刻度 + 現價 ink 圓點，同尺 ±5%
  - `<RangeBand>`：30D sparkline + 現價 accent 點 + 中文「低 X — 高 Y」
  - `<WeightRank>`：灰條 + 本檔 accent、`排名 #x／N`
  - `<ThesisHistory>`：4 欄表格（日期｜建議｜動作｜其後 ±%）＋勝率尾註
  - `<PriceAxis>` 內接 `tpHistory` → 顯示 `目標 X ↓Y%` + 編輯註記（「共識 N 日內由 X 下修至 Y…」）
  - 建議印章行（`.holdings-detail-decision` sticky top:48px 手機）：上下 1px ink 線、serif「建議 —— 續抱／檢視／出場」＋「急迫度 · 立即/儘快/觀察/低」
  - 頁腳 nav：`‹ 上一檔名 ｜ 研究筆記 ｜ 下一檔名 ›` serif
  - `holdContext`（tradeLog 推導：持有 N 天 · 加碼 M 次 · 上次 X/Y 減碼）
- **保留**：SortMenu / PrefsMenu（收斂為論點+情境模擬 2 toggle）/ ExportMenu（三段 seg + 立即匯出，`data-testid` 全保留）、鍵盤 Cmd+Z / Cmd+Shift+Z、離屏匯出、sync overlay、a11y
- **中文化**：TODAY→今日、VALUE→市值、RETURN→報酬（大字直接呈現，不加標籤）、TARGET→目標、DECISION→建議、THESIS→論點、NEXT EVENT→下個事件、HOLD/REVIEW/EXIT→續抱/檢視/出場、NOW/SOON/MONITOR/LOW→立即/儘快/觀察/低
- **e2e / CSS**：
  - `e2e/holdings-detail-panel-wide.spec.ts` / `narrow.spec.ts` 改斷言 `[data-testid="decision-stamp"]` + 無 `comparison-charts`
  - `holdingsDetailPanel.css` 刪除 `.hp-charts-row` / `.hp-cmp-row` 死規則；`.holdings-detail-decision` sticky top 由 0 改 48
- **待批次 A2 通線**：`tradeLog` / `targetPriceHistory[code]` / `thesisTracking[code]` 從 `FreeCheckup.jsx` → `HoldingsWorkbench` → `HoldingsDetailPanel` 三層 prop 通道；資料未通時 §4.3 / §4.5 / §4.8 三區以 optional chain 靜默隱藏，不會 crash

### 批次 A2 · 抽屜資料源通線


### 批次 B · 產業分佈 §3.3（`HoldingsSectorSummary.tsx`）✅
- ✅ 一條 100% 帶（高 34px、段間 2px 白縫）
- ✅ 前 5 名色階 accent → ink → ink-sub → ink-sec → ink-mute + 其他合併 hair-strong
- ✅ 帶下標籤列（前 4 名 + 「其他 N%」）
- ✅ 「索引 ↓」展開三欄純文字（第 1 名數字 accent）
- ✅ 集中度：badge 移除，改為節標下方 serif 編輯註記（前三大合計 X%）
- ✅ **保留**：既有篩選（chip toggle、聯集/交集、presets、搜尋、排序、重名檢查）邏輯

### 批次 C · 其他分頁 §6
| 檔案 | 改動 |
|---|---|
| `DailyTab` / `DailyPage.jsx` | serif 報頭；三欄個股列；刪 emoji/teal/大按鈕 |
| `EventsTab` + `NewsTab` 合併 | 兩態切換（未來 / 已驗證）；刪 TYPE_COLOR、三色統計卡、五色卡底 |
| `TradeTab` | 由 tab 改 modal（「＋ 上傳」）；虛線框投遞區 |
| `LogTab` | serif 日期節標；備忘引文；未填 faint 色 |
| 一次性引導 §6.5 | 三步 onboarding；tab 內 Demo/LINE banner 全刪，只留頁腳一行 |

### 批次 D · 資訊架構 §2（可能與 C 合併）
- 4 tab（持倉/收盤/事件/記錄）+ 「＋ 上傳」動作鈕
- 手機底部 5 格 tab bar，中央 ＋ 圓鈕
- 頂欄只留 logo + 當前頁名

### 批次 E · 一次性引導 §6.5 + Design tokens §1
- 全站退役 `#EC662D` → `--accent: #FF4D1F`（深色 `#FF6240`）
- Noto Serif TC 引入（頁標 / 節標 / 引文 / 日期主角）
- 頁面內距 `clamp(16px, 3.5vw, 40px)`

---

## 驗收清單（§8，每批完工後逐項打勾）
- [ ] 全站無 emoji / `#EC662D` 舊值 / `border-radius>0`（圓鈕除外） / `box-shadow`
- [x] 持倉卡只有 4 層資訊；hold 不顯示徽章
- [x] 報酬條 ±40% 截斷 + ▸；權證虛線 tag + 到期警示
- [ ] 抽屜內成本/現價/目標/佔比各只出現一次；甜甜圈不存在
- [ ] 持有脈絡、目標價 ↓%、決策履歷三區有資料時顯示
- [ ] 今日待辦列出全部 exit/review；「其餘 N 檔」數字正確
- [ ] 4 tab + 上傳 modal；事件頁兩態含原新聞驗證資料
- [ ] 手機：底欄、清單列、sheet、sticky 印章行
- [ ] 既有 analytics（`checkup_holding_expand` 等）、a11y、sync 狀態全數保留
