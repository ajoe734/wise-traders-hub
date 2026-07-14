
# /holding-checkup Monocle 風視覺改版（三批交付）

依 `DESIGN_HANDOFF.md` 與 `原型-prototype.html` 對 `src/checkup/components/freecheckup/` 全系列做「重排＋換皮」。**所有 hooks / props / 資料流 / analytics 事件 / a11y / sync / quota / error 邏輯完全保留**，只改呈現層。

因總幅度大（8,155 行 + 容器）且必跑 [手機回歸清單](mem://qa/checkup/freecheckup-mobile-regression-checklist)，依你建議拆三批依序交付，每批獨立可驗收：

---

## 批次 0 — 共用地基（必須先做，只做一次）

**新增檔案**
- `src/checkup/styles/tokens.css`：淺色/深色 CSS 變數（`--ink`/`--ink-sub/sec/mute/faint`、`--hair/hair-strong`、`--fill/fill-soft`、`--accent #FF4D1F`、`--accent-dark #FF6240`、`--loss #8A857F`、`--loss-bar #B8B3AB`）；`@import` Noto Sans TC + Noto Serif TC。
- `src/checkup/lib/checkupFormat.ts`：`fmtSigned(pct|amount)`（正 `+`、負 `−ˊU+2212`）、`fmtWan()`、`clampReturnBar(pct, 40)`（回傳條長與是否破表）。
- `src/checkup/components/freecheckup/_ui/`：`SectionRule`（1px ink 主線）、`Hairline`、`StampRow`（印章行）、`ReturnBar`（±40 共用尺）、`PriceTrack`（成本刻度＋現價點）、`Tag`（10px 字距）、`ActionBadge44`（出場橘底/檢視橘框）。

**Tokens 全域套用**：`FreeCheckup.jsx` 頂層 import `tokens.css`，包一層 `.checkup-mono` scope class，避免污染其他頁；退役硬編 `#EC662D`（全站唯一 accent 統一為 `--accent`）。

**不動**：`_freeCheckup/constants.jsx`、`FreeCheckup.jsx` L2965/L4745 硬合約 `<style>`（記憶標註不可外移）。

---

## 批次 1 — 持倉看板（提示詞 1–5）

覆蓋：導覽容器 + Hero + 今日待辦 + 產業分佈 + 持倉卡。

1. **`FreeCheckup.jsx` 導覽**：6 tab → 4 tab（持倉／收盤／事件／記錄）；右上「＋ 上傳」橘鈕開 modal（沿用 `TradeTab` 內容包成 modal）；`NewsTab` 併入 `EventsTab` 已驗證態（先只做 tab 收合，內容處理留批次 3）。
   - 手機 ≤640：底部 tab bar 五格，中央 46px 圓形橘鈕＝上傳。
2. **`HoldingsHero.tsx`**：刪 4 欄 KPI 帶；只留「未實現損益」10px 標籤＋大字損益（`clamp(36,7vw,52)`、% accent）＋右側一行「市值 X 萬 · N 檔 · 即時」。
3. **今日待辦**：以現有 `HoldingsActionPriority.tsx` 為資料源改呈現；serif 節標「今日待辦」+件數；每列 44px 徽章＋名稱＋一句原因＋報酬率＋「決策書 →」；列出**全部** exit/review（不截斷）；尾行「其餘 N 檔維持持有——今天不需要動作。」（N 只計 hold）。點列 → `openHoldingDrawer(sym)`。
4. **`HoldingsSectorSummary.tsx`**：15 chip → 100% 帶（34px、2px 白縫、第 1 accent、2–5 墨階、其餘 hair）＋前 3–4 標籤＋「其他 N%」；「索引 ↓」展開三欄純文字清單；集中度改一句編輯註記。**保留 toggle / 聯集/交集 / presets 全部邏輯**，只換樣式。
5. **`HoldingCard.tsx`**：4 層：(a) 名稱代號＋檢視/出場徽章＋產業 tag（權證＝虛線框「權證 · 到期 X 月」、≤1 月轉 accent）；(b) `ReturnBar` ±40 截斷＋`▸` 破表記號＋報酬率；(c) `PriceTrack` 成本刻度＋現價圓點＋兩個 10px 標籤；(d) 頁腳「今日 X ｜ 市值 Y」。刪：策略散文、TODAY/VALUE、來源徽章、股數、HOLD 徽章。手機卡牆 → 清單列（一檔一行）。

**驗收**：全部 [手機回歸清單](mem://qa/checkup/freecheckup-mobile-regression-checklist) 三斷點截圖比對原型；[H14 urgency 憲法](mem://style/holdings/h14-urgency-constitution)、[Holdings PnL 憲法](mem://style/holdings/monochrome-orange-pnl) 未回歸；`bunx playwright test e2e/freecheckup-card.spec.ts` 全綠；analytics `checkup_holding_expand` 等事件仍觸發。

---

## 批次 2 — 決策書抽屜（提示詞 6）

覆蓋：`HoldingsDetailPanel.tsx`（1,163 行）+ `HoldingExportCard.tsx` 對齊 + `holdingsDetailPanel.css` 淘汰。

**十區塊重排**（規格 §4）：
1. 操作列 sticky：文字化（‹ › ｜ 07/16 ｜ 排序 顯示 匯出 ×）
2. 識別行：`代號 · 產業 · 策略` 10px 字距 + serif 名稱 26px + 30D sparkline
3. 報酬塔：大字報酬率＋損益額；`今日 · 持股 · 市值` 一行；**新增｜持有脈絡**（`tradeLog` 推導 `持有 N 天 · 加碼 X 次 · 上次 MM/DD 減碼`）
4. 建議印章行：`1px ink` 上下線；serif「建議 —— 續抱／檢視／出場」＋急迫度「觀察／儘快／立即」；**手機 sticky top:48px**
5. 一條價格軸：合併原「成本/現價文字＋TARGET 條＋成本↔現價軸」；目標 accent 刻度、成本灰刻度、現價 ink 圓點；**新增｜目標價修正**（`targetPriceHistory`：`目標 1,175 ↓7%` ＋一句判斷）
6. 一條 30D 走勢帶：sparkline＋現價 accent 點＋`低 — 高` 數字
7. 佔比排名表：第 1 名灰條＋本檔 accent 條＋`排名 #8 ／ 16`；**刪甜甜圈**
8. **新增｜決策履歷**（`thesisTracking`）：`日期｜建議｜你的動作｜其後 ±%` 表；尾註「近 N 次照做勝率 x/N」
9. 情境模擬：收合列（調整後亮 SIM）；展開全功能，`holdingScenario.ts computeScenario` **不改**
10. 論點引文（serif 全形引號）＋`論點完整 · 信心高 · 下個事件 10/30 法說會`；頁腳 `‹ 上一檔名 ｜ 研究筆記 ｜ 下一檔名 ›`

**刪**：甜甜圈、RETURN/TARGET/THESIS/NEXT EVENT 英文小標、黑底 DECISION 盒、急迫度五點、反向 TARGET 紅條。
**保**：aria-label、sr 播報、shimmer/error strip、`openHoldingDrawer` 進出口、鍵盤導覽、匯出流程（`HoldingExportCard` 樣式跟著改）。

---

## 批次 3 — 其他分頁與引導（提示詞 7–11）

7. **`DailyTab.jsx`**：報頭 serif＋日期＋餘次；分析文 serif 15–16px；個股三欄列；頁腳歷史＋「重新分析 →」。刪置中大按鈕/teal/emoji。錯誤/重試/配額保留。
8. **`EventsTab.jsx` + `NewsTab.jsx` 合併**：報頭兩態切換「未來 N ｜ 已驗證 N · 命中率 x%」；未來列＝serif 日期/型別灰字/摘要/預測漲(accent)或待觀察(mute)；已驗證列＝命中(accent)/未中(mute)＋事後 ±%。刪 ⟳✓⚠ 徽章牆（改「更新於 HH:MM · 立即更新」一行）、TYPE_COLOR 八色 chip、統計色卡、五色卡底。除錯面板收進「更新於」行的長按。行事曆同步/預測/重試邏輯保留。`NewsTab.jsx` 保留為資料 hook（或整併），路由不再獨立。
9. **`TradeTab.jsx` → 上傳 modal**：批次 1 已把觸發改成右上鈕；此批把 `TradeTab` 內容包成 modal shell（serif 報頭＋餘次、虛線投遞區 hover 轉 accent、頁腳手動目標價入口）。批次解析、去重、備忘三問全保留。
10. **`LogTab.jsx`**：serif 日期節標；買進(accent)/賣出(#8A857F) 一字；備忘問答改左 1px 髮絲 serif 引文；未填顯示 faint 色「（未留筆記）補寫 →」。
11. **一次性引導**：首訪全屏卡「三步，把持倉變成每天的決策書。」＋「LINE 登入開始」(ink 底)/「先看示範資料」(hair 框)；用 `localStorage.setItem('checkup_onboarded_v1','1')` 記錄；移除所有 tab 內重複的 Demo/LINE 提示框，只留頁腳「示範資料 · 登入」一行。**Demo 模式** [記憶規則](mem://features/checkup/demo-mode-behavior) 完整保留。

---

## 技術細節（開發時檢核）

- **不改**：`useHoldings*` hooks、`holdingScenario.ts`、`_freeCheckup/constants.jsx` 內容、FreeCheckup.jsx L2965/L4745 硬合約 `<style>`、任何 RPC/hook signature、[Expert holdings 單一資料源](mem://architecture/expert-holdings-single-source)。
- **色 token**：全站 `--accent` 統一，`#EC662D` 只在硬合約 `<style>` 允許保留；商品層新程式碼禁用 hex。
- **字級**：10px 只用於欄名/字距標籤；卡片報酬 18–20；Hero 大字 `clamp(36px,7vw,52px)`；使用 `font-variant-numeric: tabular-nums`。
- **形狀**：`border-radius: 0` 全站（例外：手機底欄中央上傳圓鈕）；`box-shadow: none`。
- **負號**：所有損益/漲跌統一 `−` (U+2212)；`fmtSigned()` 集中處理。
- **RWD**：每批完成後跑 560/390/380 三斷點視覺 QA + `bunx playwright test e2e/freecheckup-card.spec.ts` + `bunx tsgo` 型別檢查。
- **i18n**：跑 [i18n 回歸](mem://qa/checkup/freecheckup-i18n-regression) 對照表確認 TODAY→今日、VALUE→市值 等 12 條翻譯無漏。
- **Analytics**：`checkup_holding_expand`、`checkup_tab_switch`、`checkup_scenario_run` 等既有事件全數在新 DOM 上保留 `data-testid` 與 `onClick` 追蹤點。

## 交付節奏

1. 我先做 **批次 0 地基**，一併夾在批次 1 交付（不獨立驗收）。
2. 批次 1 完成 → 你在 preview 檢視持倉頁與原型是否對齊 → 回「OK 下一批」。
3. 批次 2 完成 → 檢視抽屜 → 回覆。
4. 批次 3 完成 → 全站最終比對驗收清單八條。

任一批完成前，若你追加修改（例如某 token 微調），會回到當批修，不擠壓下一批。

若同意，我從**批次 0 + 1（看板）**開始動工。
