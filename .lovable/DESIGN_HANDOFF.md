# legendflow /holding-checkup 視覺改版 — 設計交接規格

版本 2026-07-15 · 適用路由 `/holding-checkup`（freecheckup 元件系）
美學基準：Monocle / Kinfolk / MUJI 編輯設計。零陰影、零圓角、零 emoji。
互動原型：`原型-prototype.html`（桌機＋手機響應式，可直接開啟操作）
設計探索紀錄：`設計探索-canvas.html`（Turn 1–6 全部選項與定案理由）

---

## 0. 一頁摘要（定案）

| 區塊 | 定案 | 原方案問題 |
|---|---|---|
| 產業分佈 | 2b 版面式：一條 100% 帶＋三欄純文字索引 | 15 個等大 chip，1% 與 20% 同視覺權重 |
| 持倉卡 | 1c 視覺化：報酬條＋價格軌＋今日/市值一行 | 9 層資訊、中英夾雜、策略散文 |
| 持倉抽屜 | 3a 決策書：重複數字歸一＋3 個新增區塊 | 同一數字出現 3 次、黑盒 DECISION、4 圖表框 |
| 導覽 | 4 tab（持倉/收盤/事件/記錄）＋「＋上傳」動作鈕 | 6 tab；上傳是動作不是頁面；新聞=事件的已驗證態 |
| 其他分頁 | 5a–5e 編輯化（見 §6） | emoji 徽章、莫蘭迪色卡、彩色 type chip |
| 引導 | 一次性三步 onboarding，之後只留頁腳一行 | Demo/LINE 提示框在 5 個 tab 重複 |

---

## 1. Design Tokens

### 1.1 淺色（/holding-checkup 主題）
```
--bg:            #FFFFFF     頁面
--fill:          #F4F2EE     條軌、tag 底
--fill-soft:     #FAFAF8     hover / 選取列
--ink:           #0A0A0A     主文字、規則線（粗）
--ink-sub:       #3A3A3A     正文
--ink-sec:       #6B6862     次要文字
--ink-mute:      #9B968D     標籤、輔助
--ink-faint:     #C7C2BA     佔位（如「未留筆記」）
--hair:          #ECEAE5     髮絲線
--hair-strong:   #D4D1C9     虛線框、軌道
--accent:        #FF4D1F     唯一強調色（統一後取代 #EC662D）
--loss:          #8A857F     虧損文字（單色橘紅憲法：負向用灰不用綠紅）
--loss-bar:      #B8B3AB     虧損條
```

### 1.2 深色（會員版 /checkup 同語彙）
```
--bg: #0B0E14  --surface: #13161F  --text: #D8DBE3  --sub: #8B90A0
--hair: rgba(148,163,184,0.10)  --hair-strong: rgba(148,163,184,0.25)
--accent-dark: #FF6240（#FF4D1F 提亮版）
```
**Token 統一提案：退役 `#EC662D`，全站 `--accent` 淺 #FF4D1F／深 #FF6240。**

### 1.3 字體與字級
- UI／數字：`Noto Sans TC`，所有數字 `font-variant-numeric: tabular-nums`
- 標題／印章行／引文／日期主角：`Noto Serif TC`（serif 是編輯感的核心）
- **字級鐵律：10px 只給純標籤（欄名、letter-spacing 0.14–0.24em 小標）；任何要讀的內容 ≥12px**
- 尺度：頁標 serif 22–24 ／ 節標 serif 15–17 ／ 正文 12–13 ／
  卡片報酬率 18–20 ／ 抽屜與 Hero 大字 `clamp(36px, 7vw, 52px)`
- 損益數字：正 = accent、weight 500；負 = --loss、weight 400；正負號用 `+`／`−`（U+2212）

### 1.4 形狀憲法
- border-radius: 0（例外：手機底欄中央上傳鈕為圓形）
- box-shadow: none；層次一律用髮絲線與底色
- 區塊分隔：主分隔 `1px solid var(--ink)`、次分隔 `1px solid var(--hair)`

---

## 2. 資訊架構（6a）

- 頂欄（桌機）：logo ＋ 4 tab（持倉／收盤／事件／記錄）＋ 右側「＋ 上傳」橘底鈕
- 「上傳成交」由 tab 降級為 modal（見 §6.4）；「新聞驗證」併入「事件」的已驗證態（見 §6.3）
- 手機（≤640px）：底部 tab bar 五格＝持倉／收盤／【＋圓鈕＝上傳】／事件／記錄；頂欄只留 logo＋當前頁名

## 3. 持倉頁

### 3.1 Hero
- 「未實現損益」10px 字距標籤 ＋ 大字 `+12,742 +8.42%`（% 用 accent）
- 右側一行：`市值 15.2萬 · 16 檔 · 即時`（金額 ≥萬 用 fmtN「萬」格式）
- 刪除原 4 欄 KPI 帶（Total Value / Holdings / Win Rate / Cost Basis）

### 3.2 今日待辦（取代 HoldingsActionPriority 的呈現）
- Hero 下第一區塊，`1px solid ink` 頂線＋serif 節標「今日待辦」＋件數
- 每列：`[出場|檢視]徽章(44px) ＋ 名稱＋一句原因＋報酬率 ＋ 「決策書 →」(mute 色)`
- 出場徽章＝橘底白字；檢視＝橘框橘字；列出**全部** exit/review 持股（不截斷）
- 尾行：「其餘 N 檔維持持有——今天不需要動作。」N 只計 hold
- 點列 → 開該檔決策書抽屜

### 3.3 產業分佈（2b，改寫 HoldingsSectorSummary）
- 一條 100% 帶（高 34px、段間 2px 白縫）：市值第 1 名 accent，第 2–5 名墨階
  `#0A0A0A → #3A3A3A → #6B6862 → #9B968D`，其餘合併 `--hair` 一段
- 帶下標籤列：前 3–4 名＋「其他 N%」；手機少列一項
- 「索引 ↓」展開三欄純文字清單（名稱＋數字，第 1 名數字 accent），零卡片零底色
- 集中度：badge 改為索引上方一句編輯註記（如「前三大合計 53%——集中度偏高」）
- **保留既有篩選邏輯**：點索引列＝原 chip 的 toggle；聯集/交集、預設（presets）功能照舊，樣式套本規格

### 3.4 持倉卡（1c，改寫 freecheckup/HoldingCard.tsx）
卡片結構（上到下）：
1. 標頭：`名稱 代號` ＋ 檢視（橘字）/出場（橘底白字）徽章 ｜ 右側產業 tag（10px、--fill 底）
   - 權證 tag：透明底＋虛線框＋「權證 · 到期 X 月」；到期 ≤1 月 → 框字轉 accent
2. 報酬條＋數字：橫條軌 `--fill` 高 8px；**共用尺規 ±40%**（可調 token），
   條長 = min(|pct|,40)/40；正向 accent 由左、負向 --loss-bar 由右；
   |pct|>40 → 條拉滿＋右上 `▸` accent 破表記號；數字照實顯示
3. 價格軌：1px 髮絲線，成本＝1px 灰刻度、現價＝8px 圓點（正 accent／負 --loss）；
   下方 `成本 X ｜ 現價 Y`（10px 標籤級）
4. 頁腳（髮絲線上方）：`今日 +423 ｜ 市值 9,457`
**刪除**：策略散文、TODAY/VALUE 英文欄、價格來源徽章（移入抽屜 title）、股數（移入抽屜）、HOLD 徽章（hold 不標）
- hover：邊框轉 ink；選取中：邊框 ink＋底 --fill-soft
- 手機：卡牆 → 清單列（一檔一行：名稱徽章＋今日/市值第二行｜64px 迷你條｜報酬率右對齊）

## 4. 決策書抽屜（3a，改寫 HoldingsDetailPanel.tsx）

桌機＝右側 440px 側板（border-left hair）；手機＝底部上滑 sheet（top:10%、border-top hair），遮罩 `rgba(10,10,10,0.18)`。

**十區塊順序（全保留，重複數字歸一）：**
1. 操作列（sticky）：`‹ › ｜ 07／16 ｜ 排序 顯示 匯出 ×` 全文字化；排序/顯示/匯出選單功能照舊
2. 識別：`代號 · 產業 · 策略` 10px 字距行 ＋ serif 名稱 26px ＋ 右上 30D sparkline
3. 報酬塔：大字報酬率＋損益額；`今日 X% · Y　持股 N · 市值 V` 一行；
   **新增｜持有脈絡**（tradeLog 推導）：`持有 87 天 · 加碼 2 次 · 上次 6/12 減碼`
4. 建議印章行：上下 `1px ink` 線，serif「建議 —— 續抱／檢視／出場」＋右側「急迫度・觀察／儘快／立即」
   （now/soon→accent、其餘 mute）。**手機 sticky 於操作列下（top:48px）**
5. 一條價格軸（併掉成本/現價文字格＋TARGET 條＋成本↔現價軸圖）：
   目標＝accent 刻度、成本＝灰刻度、現價＝ink 圓點，同一尺（min/max ±5% padding）；
   **新增｜目標價修正方向**（targetPriceHistory）：標籤 `目標 1,175 ↓7%`；
   軸下一句編輯註記（負 upside 寫成判斷：「共識 30 日內由 1,260 下修至 1,175，低於現價 18.4%——已超漲」）
6. 一條 30D 走勢帶（併掉區間文字格＋區間位置圖）：sparkline＋現價 accent 點＋`低 — 高` 數字
7. 佔比排名表（併掉佔比文字格＋甜甜圈＋排名圖；**甜甜圈刪除**）：
   第 1 名灰條 ＋ 本檔 accent 條，`排名 #8 ／ 16`
8. **新增｜決策履歷**（thesisTracking）：`日期｜建議｜你的動作｜其後 ±%` 表格，
   尾註「近 N 次建議照做勝率 x/N」
9. 情境模擬：收合列（調整後亮 SIM 徽章）；展開＝原沙盒全功能
   （公式沿用 `holdingScenario.ts` computeScenario，不改）；目標價/停損輸入＋加減碼滑桿＋均價/損益%/上檔/風報比＋重設
10. 論點引文（serif、全形引號）＋一行 `論點完整 · 信心高 · 下個事件 10/30 法說會`；
    頁腳 `‹ 上一檔名 ｜ 研究筆記 ｜ 下一檔名 ›`（研究筆記＝原 openHoldingDrawer 入口）

**刪除清單**：甜甜圈圖、RETURN/TARGET/THESIS/NEXT EVENT 英文小標（全中文化）、黑底 DECISION 盒、急迫度五點（改文字）、反向 TARGET 紅條。
**a11y**：aria-label、sr 播報、同步 shimmer/error strip 邏輯全保留，僅換樣式。

## 5. 標籤中文化對照
`TODAY→今日 ｜ VALUE→市值 ｜ RETURN→報酬 ｜ TARGET→目標 ｜ TGT→目標 ｜ DECISION→建議 ｜ THESIS→論點 ｜ NEXT EVENT→下個事件 ｜ HOLD→續抱 ｜ REVIEW→檢視 ｜ EXIT→出場 ｜ NOW/SOON/MONITOR/LOW→立即/儘快/觀察/低`

## 6. 其他分頁（5a–5e）

### 6.1 收盤分析（DailyTab）
報頭 serif「收盤分析」＋右側 `日期 · 今日餘 N 次`；分析文＝serif 正文 15–16px/行高 2；
個股列＝三欄（名稱｜漲跌｜一句判斷，判斷內關鍵詞可 accent）；頁腳＝歷史日期＋「重新分析 →」。
刪：置中大按鈕、字距標題、teal 色、emoji。錯誤/重試/配額邏輯保留，樣式改一行字＋鏈結。

### 6.2 事件（EventsTab ＋ NewsTab 合併）
報頭右側兩態切換：`未來 N ｜ 已驗證 N · 命中率 x%`。
未來列：`serif 日期｜型別灰字｜一句摘要｜預測漲(accent)/待觀察(mute)`；
已驗證列：`serif 日期｜摘要｜命中(accent)/未中(mute) ＋ 事後 ±%`。
刪：⟳✓⚠ 徽章牆（改「更新於 14:32 · 立即更新」一行）、TYPE_COLOR 八色 chip、三張統計色卡、五色輪替卡底。
行事曆同步/預測/重試/除錯面板功能保留（除錯面板可收進「更新於」行的長按/開發旗標）。

### 6.3 上傳成交（TradeTab → modal）
「＋ 上傳」開啟置中 modal：serif 報頭＋`今日餘 N 次 · 18:00 重置`；虛線框投遞區（hover 框轉 accent）；
頁腳 `手動輸入目標價 → ｜ 上次上傳資訊`。批次解析、去重、備忘三問流程照舊（解析完成後逐筆帶出）。

### 6.4 交易記錄（LogTab）
serif 日期小節標；每筆：`買進(accent)/賣出(--loss) 一字＋名稱代號 ｜ 時間 · N 股 @ 價`；
備忘問答 → 左 1px 髮絲引文（serif），未填顯示 faint 色「（未留筆記）補寫 →」。

### 6.5 一次性引導（6b）
首次進站全屏卡：「三步，把持倉變成每天的決策書。」＋ 一二三（serif 數字 accent）＋
`LINE 登入開始（ink 底）｜先看示範資料（hair 框）`；之後所有 tab 內 Demo/LINE 提示框移除，只留頁腳一行「示範資料 · 登入」。

## 7. RWD（斷點 640px）
- ≤640：底部 tab bar；卡牆→清單列；抽屜→底部 sheet＋印章行 sticky；
  hero `clamp(36,7vw,52)`；頁面內距 `clamp(16px,3.5vw,40px)`；產業帶標籤少列一項
- 沿用既有 `holdingsDetailPanel.css` 的橫滑規則於情境模擬欄位（≤640 橫滑）

## 8. 驗收清單
- [ ] 全站搜不到 emoji、`#EC662D`（深色 accent 除外之舊值）、border-radius>0（圓鈕除外）、box-shadow
- [ ] 持倉卡只有 4 層資訊；hold 不顯示徽章
- [ ] 報酬條 ±40% 截斷＋▸；權證虛線 tag＋到期警示
- [ ] 抽屜內成本/現價/目標/佔比各只出現一次；甜甜圈不存在
- [ ] 持有脈絡、目標價 ↓%、決策履歷三區有資料時顯示
- [ ] 今日待辦列出全部 exit/review；「其餘 N 檔」數字正確
- [ ] 4 tab＋上傳 modal；事件頁兩態含原新聞驗證資料
- [ ] 手機：底欄、清單列、sheet、sticky 印章行
- [ ] 既有 analytics 事件（checkup_holding_expand 等）、a11y、sync 狀態全數保留
