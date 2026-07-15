# /holding-checkup 視覺改版 — 執行進度

規格：`.lovable/DESIGN_HANDOFF.md`（2026-07-15，Monocle/Kinfolk/MUJI 編輯設計）

## 已完成

### S1 · 持倉卡 §3.4 ✅
- 卡頭 `名稱 代號` + 檢視/出場徽章 + 產業 tag；權證虛線 tag + 到期警示；HOLD 不渲染徽章
- 移除股數、策略 tag、教學徽章、回報鈕、可見 sparkline（保留 hidden 契約）
- Return/PriceTrack/Footer 使用 `<ReturnBar>` / `<PriceTrack>` / 中文一行 footer

### 批次 A · 抽屜 §4 ✅
- `HoldingsDetailPanel` 1163 → 750 行，10 區塊按規格重排
- 刪 4 圖框、黑底 DECISION、五點急迫度、反向 TARGET、`SHARE MODE`、英文小標
- 新 `<PriceAxis>` / `<RangeBand>` / `<WeightRank>` / `<ThesisHistory>` + 目標價修正 + 建議印章
- 中文化：TODAY→今日、VALUE→市值、DECISION→建議、HOLD→續抱 等

### 批次 A2 · 抽屜資料源通線（未做，資料未通時 optional chain 靜默隱藏）

### 批次 B · 產業分佈 §3.3 ✅
- 一條 34px 100% 帶 + 前 4 名 + 「其他」+ 「索引 ↓」三欄純文字
- 集中度改編輯註記；保留篩選/聯集/交集/presets 邏輯

### 批次 C · §6 其他分頁：結構與路由 ✅（本輪）

**§6.3 上傳成交 modal 化**
- 新 `TradeUploadModal.jsx`：ESC / 背景 / × 關閉、focus trap、`data-testid="trade-upload-modal"`
- 內部直接掛 `<TradeTab {...tradeProps}>`，內部 DOM 與所有 e2e 選擇器不變
- Header serif「上傳成交」+ `今日餘 N 次 · 倒數`；footer 頁腳提示
- `FreeCheckup.jsx`：
  - `uploadModalOpen` state；`openUploadModal()` / `closeUploadModal()`
  - 桌機 `.cm-upload-cta` + 手機底欄 `.cm-mobile-tabbar__upload` 改呼叫 `openUploadModal()`
  - 原 `tab==='trade'` 區塊改由 `TradeUploadModal` 承接（`modalOpen = uploadModalOpen || tab === 'trade'`）
  - 傳入 `setTab` wrapper：`setTab('holdings')` 時自動 `setUploadModalOpen(false)`（上傳成功後既有 flow 相容）

**§6.2 事件 + 新聞驗證合併**
- `EventsTab.jsx` 新增報頭 + 兩態 pill (`upcoming` / `verified`)：
  - 報頭 serif `事件` + `未來 N ｜ 已驗證 N · 命中率 x%`
  - `verified` 模式：從 `newsEvents.filter(status==='past')` 產列 `serif 日期 ｜ 摘要 ｜ 命中(accent)/未中(mute) + 事後 ±%`
  - `upcoming` 模式：原 EventsTab body 抽出為 `UpcomingEventsBody`，資料/更新/除錯面板全數保留
- `NewsTab.jsx` 保留但無入口（`tab==='news'` 僅由 DailyTab「前往復盤」內部呼叫）

**§6.5 一次性引導**
- 新 `OnboardingOverlay.jsx`：`localStorage 'lf.checkup.onboarded'` 判斷
  - Serif 22px 標題 + 三步（01 上傳 · 02 診斷 · 03 決策）+ `LINE 登入開始` / `先看示範資料` 按鈕
- 新 `DemoFooterHint.jsx`：`isDemo` 時於頁面底部顯示一行 `示範資料 · 尚未登入 · LINE 登入 → · Email 登入`

**§6.1 收盤分析 / §6.4 交易記錄 編輯化 → 順延批次 C2**
- DailyTab / LogTab 內部視覺（serif 節標、刪 emoji/teal、引文塊、日期 grouper）未動；結構與路由已對齊，視覺重寫留給下一輪，避免同輪過大混合改動。

**建置驗證**
- `bunx tsgo --noEmit -p tsconfig.app.json`：綠
- `bunx vite build`：綠（FreeCheckup chunk 128 KB）

---

## 待辦

### 批次 C2 · DailyTab / LogTab 編輯化 ✅（本輪）

**DailyTab**
- 移除 needsAddFriend 藍色 banner；`isDemo` banner 收斂為單行 DEMO 資料源切換
- 起始態刪置中大 teal 按鈕：改 serif h3「收盤分析」＋一句提示＋文字鏈結「開始今日收盤分析 →」
- 全站 emoji 清零（📣🔒🎁📋⚡⚠▶ 全刪；✕ 為關閉鈕保留）
- teal 色全數 → ink：重試鈕、分析進度條、命中色改 accent
- 所有 `letterSpacing:0.12em fontWeight:700` 字距標題 → serif h3 + `1px solid var(--cm-ink)` 頂線：AI 策略分析／自動驗證／需要復盤／策略大腦／歷史記錄
- `TODAY P&L` → 今日損益；歷史列 ▶ 三角形 → `›`/`—`；日期改 serif + tabular-nums
- 頁腳「重新分析 →」文字鏈結（取代整寬邊框按鈕）

**LogTab**
- 移除 isDemo banner（收斂至頁腳 DemoFooterHint）
- serif 日期節標 + `1px solid var(--cm-ink)` 頂線 + 右側件數
- 買進 → `var(--cm-accent)`、賣出 → `var(--cm-loss)`（原 C.up/C.down 撤除）
- 備忘引文改左 1px 髮絲 + serif；未填顯示 `var(--cm-ink-faint)`「（未留筆記）補寫 →」
- 空狀態改 serif 「還沒有交易記錄」（無 emoji）

**驗證**：`bunx tsgo` 綠；`rg` 確認兩檔已無 teal / 禁用 emoji。

### 批次 D · IA §2 手機頂欄簡化 ✅（本輪）
- 手機頂欄僅保留 `<Logomark size={20}/>` + `持倉看板` + `⋯ 更多` 按鈕
- 隱藏於 ≤640px：`.cm-header-actions`（⟳ 立即更新／補齊報價／⋯／↓ Log／時戳）、`.cm-header-pnl`（右側未實現損益，Hero 已有）、`.cm-header-meta`（LINE displayName／saved）、`前往戰情室 →`
- 修正：`.cm-desktop-tabs { display: none !important }` 覆蓋 inline `display:flex`
- 新增 `mobileActionsOpen` state + bottom-sheet：`前往戰情室 / ⟳ 立即更新報價 / 補齊缺價持倉 / ↓ 下載任務日誌 / 清除全部資料 / 取消`（背景點擊或取消可關）
- Desktop 樣式與行為 100% 保留（`.cm-header-mobile-actions`、`.cm-header-mobile-logomark` 於 ≥641px `!important` 隱藏）

### 批次 E · Design tokens §1（已完成，範圍收斂於 Checkup）
- [x] **Checkup 內部 accent 換色**：`src/checkup/theme.js`（up/urgent/fillTomato ×2 主題）、`holdingsTokens.js`（accent/gain）、`DailyReportPanel.jsx` 註解 全數 `#EC662D → #FF4D1F`。品牌識別 (`brand/*.svg`、favicon、theme-color、Index.tsx、`--cta`/`--advisor`/`--jh-candle`) 依 core memory 保留 `#EC662D`。
- [x] **Noto Serif TC self-host woff2**：`@fontsource/noto-sans-tc` + `@fontsource/noto-serif-tc` 安裝，於 `FreeCheckup.jsx` 頂端引入 `chinese-traditional-{400,500,600,700}.css`；`checkupTokens.css` 移除 Google Fonts 遠端 `@import`。
- [x] **頁面內距 token**：`--cm-page-px: clamp(16px, 3.5vw, 40px)` 定義於 `.checkup-mono :root`；`.cm-page-content { padding: 14px var(--cm-page-px); }`，移除 `FreeCheckup.jsx` L3695 inline `padding:"14px 14px"`。實測 1280px 下 computed = `14px 40px` ✓。

### 批次 F · Token 全域擴散（本輪）
- [x] `checkupTokens.css` 新增 `--cm-page-py: 10px` 與全域 utility `.cm-shell-inner` / `.cm-header-inner`（脫離 `.checkup-mono` scope，供多個 layout 共用）。
- [x] `AppShellFrame.jsx` — 移除內嵌 Google Fonts `<style>` @import、`fontFamily: "'Inter',..."` → `var(--cm-font-sans)`、`padding: '10px 14px'` inline → `className="cm-shell-inner"`。
- [x] `PortfolioLayout.jsx` — 同上（`fontFamily` token + `className="cm-shell-inner"`）。
- [x] `Header.jsx` — `padding: '10px 14px 0'` inline → `className="cm-header-inner"`。
- [x] `FreeCheckup.jsx` L4156 (`.holding-drawer-mobile-close` @media) `padding: 10px 14px ...` → `var(--cm-page-py) var(--cm-page-px) ...`。
- [x] 移除三處 inline `#FF4D1F` → `var(--cm-accent)`：`EventsTab.jsx` L146、`OnboardingOverlay.jsx` L72、`holdingsTab.css` L137/L149（focus-visible outline ×2）。
- [x] `OnboardingOverlay.jsx` inline `fontFamily: "'Noto Serif TC',..."` → `var(--cm-font-serif)`。


---

## 驗收清單（§8）
- [ ] 全站無 emoji / `#EC662D` / `border-radius>0`（圓鈕除外） / `box-shadow`
- [x] 持倉卡只有 4 層資訊；hold 不顯示徽章
- [x] 報酬條 ±40% 截斷 + ▸；權證虛線 tag + 到期警示
- [ ] 抽屜內成本/現價/目標/佔比各只出現一次；甜甜圈不存在
- [ ] 持有脈絡、目標價 ↓%、決策履歷三區有資料時顯示
- [ ] 今日待辦列出全部 exit/review；「其餘 N 檔」數字正確
- [x] **4 tab + 上傳 modal**；事件頁兩態含原新聞驗證資料
- [ ] 手機：底欄、清單列、sheet、sticky 印章行
- [ ] 既有 analytics、a11y、sync 狀態全數保留（本輪未動）
- [x] **Demo/LINE banner 頁腳一行**（DailyTab/EventsTab 頂部原 banner 於 C2 一起清除）
