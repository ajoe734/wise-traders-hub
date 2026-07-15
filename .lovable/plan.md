
# /holding-checkup 完整改版執行計畫

依 `DESIGN_HANDOFF-3.md` §1–§8 與 `LOVABLE_PROMPT-2.md` 11 條，把先前只做到 §3.3/§3.4 的範圍補齊到全站。所有既有邏輯、hooks、props、資料流、analytics 事件、a11y、sync/error/配額處理 **只換皮不重寫**。

---

## 階段 0 · Tokens 與字體（§1）
- `src/checkup/styles/checkupTokens.css`：確認 `--cm-*` 對齊 handoff 淺色 token（bg/fill/fill-soft/ink/ink-sub/ink-sec/ink-mute/ink-faint/hair/hair-strong/accent #FF4D1F/loss #8A857F/loss-bar #B8B3AB）；深色版新增 `--accent-dark #FF6240`。
- 全站搜尋並退役 `#EC662D` → `var(--cm-accent)`。
- `index.html` 或字體 loader 補 `Noto Serif TC`（標題/引文/日期主角）；`Noto Sans TC` 保留為 UI；數字統一 `font-variant-numeric: tabular-nums`。
- 形狀憲法檢查：`rg` 掃 `border-radius`（>0 除手機圓鈕外全清 0）、`box-shadow`（清除）、emoji（清除）。

## 階段 1 · 導覽收斂 6→4 tab ＋ 上傳 modal（§2 / §6.3）
- `src/pages/FreeCheckup.jsx` 容器：
  - Tab 由 6 → 4（**持倉／收盤／事件／記錄**）；「上傳成交」由 tab 降級為右上 `＋ 上傳` 橘鈕開 modal；「新聞分析」併入「事件」頁的「已驗證」態。
  - 桌機頂欄：logo ＋ 4 tab ＋ 右側 `＋ 上傳`。
  - 手機 ≤640px：底部 tab bar 五格，中央 46px 圓形橘鈕 = 上傳。
- 新增 `UploadTradesModal`（沿用 `TradeTab` 現有解析/去重/配額/備忘三問邏輯，只換外觀）。
- `NewsTab` 邏輯保留、視覺併入 EventsTab（見階段 5）。

## 階段 2 · 持倉頁 Hero ＋ 今日待辦（§3.1 / §3.2）
- `HoldingsHero.tsx`：
  - 只留「未實現損益」10px 字距標籤 ＋ 大字 `+12,742 +8.42%`（% accent，`clamp(36px,7vw,52px)`）＋右側一行 `市值 X萬 · N 檔 · 即時`。
  - 刪除原 4 欄 KPI（Total Value / Holdings / Win Rate / Cost Basis）。
- 新增 `HoldingsTodoSection.tsx`（取代 `HoldingsActionPriority` 呈現，資料來源不變）：
  - `1px solid ink` 頂線＋serif 節標「今日待辦」＋件數。
  - 列出**全部** exit/review 持股（不截斷）：`[出場|檢視] 44px 徽章 ＋ 名稱＋一句原因＋報酬率 ＋「決策書 →」`。
  - 尾行「其餘 N 檔維持持有——今天不需要動作。」（N 只計 hold）。
  - 點列 → 開該檔決策書抽屜（沿用 `onOpenDrawer`）。

## 階段 3 · 產業分佈 §3.3 收尾
- `HoldingsSectorSummary.tsx`：
  - 100% 帶第 1 名 accent、第 2–5 名 `#0A0A0A→#3A3A3A→#6B6862→#9B968D`、其餘合併 `--cm-hair`；段間 2px 白縫。
  - 帶下標籤前 3–4 名＋「其他 N%」（手機少列一項）。
  - 「索引 ↓」展開三欄純文字清單（第 1 名數字 accent）；聯集/交集、presets、chip toggle 邏輯**保留**只換樣式。
  - 集中度改為索引上方一句編輯註記（`前三大合計 X%——集中度偏高/適中`）。

## 階段 4 · 持倉卡 §3.4（先前已改，本輪補漏）
- 檢查現況：4 層結構、`+`/`−`（U+2212）、報酬條 ±40% ＋ `▸`、價格軌、頁腳「今日｜市值」皆已就位。
- **本輪補**：
  - 手機 ≤640px 由「卡牆」改為「清單列」（一檔一行：名稱徽章 ＋ 今日/市值第二行 ｜ 64px 迷你條 ｜ 報酬率右對齊）。
  - hover：邊框 `var(--cm-ink)`；選取中：邊框 ink＋底 `--cm-fill-soft`。
  - 權證徽章：`meta.instrument === 'warrant'` → 虛線框「權證 · 到期 X 月」，≤1 月轉 accent（現已具備，複驗）。

## 階段 5 · 決策書抽屜 §4（十區塊重排）
`HoldingsDetailPanel.tsx` 依 §4 十區塊順序重排，重複數字歸一：
1. sticky 操作列全文字化 `‹ › ｜ 07/16 ｜ 排序 顯示 匯出 ×`。
2. 識別行 `代號 · 產業 · 策略` 10px ＋ serif 名稱 26px ＋ 右上 30D sparkline（sparkline 移入處）。
3. 報酬塔 ＋ 新增「持有脈絡」（tradeLog 推導 `持有 87 天 · 加碼 2 次 · 上次 6/12 減碼`）。
4. 建議印章行（serif「建議 —— 續抱/檢視/出場」＋ 急迫度文字化 立即/儘快/觀察；手機 sticky top:48px）。
5. **一條**價格軸（併三處重複：成本/現價/目標一尺；新增「目標 1,175 ↓7%」＋編輯註記）。
6. **一條** 30D 走勢帶（併區間文字＋位置圖；sparkline＋現價 accent 點＋`低 — 高`）。
7. 佔比排名表（**刪甜甜圈**；第 1 名灰條 ＋ 本檔 accent 條 ＋ `排名 #8 / 16`）。
8. 新增「決策履歷」（thesisTracking 表：日期｜建議｜你的動作｜其後 ±%，尾註勝率）。
9. 情境模擬收合列（`computeScenario` **不改**，全功能保留）。
10. 論點引文（serif、全形引號）＋ 頁腳 `‹ 上一檔 ｜ 研究筆記 ｜ 下一檔 ›`。
- 中文化：TODAY/VALUE/RETURN/TARGET/TGT/DECISION/THESIS/NEXT EVENT/HOLD/REVIEW/EXIT/NOW/SOON/MONITOR/LOW 全換（§5）。
- **刪**：甜甜圈、英文小標、黑底 DECISION 盒、急迫度五點、反向 TARGET 紅條。
- a11y、shimmer、error strip 樣式微調但邏輯保留。

## 階段 6 · 其他分頁編輯化（§6.1 / §6.2 / §6.4 / §6.5）
- **DailyTab**：serif 報頭＋日期＋餘次；分析文 serif 15–16px/行高 2；個股三欄列；頁腳歷史＋「重新分析 →」。刪置中大鈕、字距標題、teal、emoji。錯誤/重試/配額邏輯保留。
- **EventsTab（併 NewsTab）**：報頭兩態切換 `未來 N ｜ 已驗證 N · 命中率 x%`；未來與已驗證兩種列樣式；刪 ⟳✓⚠ 徽章牆改「更新於 HH:MM · 立即更新」一行；刪 TYPE_COLOR 八色 chip、統計色卡、五色卡底。行事曆/預測/重試/除錯面板功能保留（除錯收進長按/開發旗標）。
- **LogTab**：serif 日期節標；`買進(accent)/賣出(--cm-loss)` 一字；備忘 → 左 1px 髮絲 serif 引文；未填 faint「（未留筆記）補寫 →」。
- **一次性引導**：首訪全屏卡「三步，把持倉變成每天的決策書。」＋ 三步 serif accent 數字 ＋ `LINE 登入開始 ｜ 先看示範資料`；移除 5 個 tab 內所有 Demo/LINE 提示框，頁腳保留一行「示範資料 · 登入」。

## 階段 7 · RWD ＋ 驗收（§7 / §8）
- 斷點 640px：底部 tab bar、卡牆→清單列、抽屜→底部 sheet＋印章行 sticky、hero `clamp(36,7vw,52)`、頁面內距 `clamp(16px,3.5vw,40px)`、產業帶標籤少列一項；沿用 `holdingsDetailPanel.css` 情境模擬橫滑規則。
- 驗收 grep：`emoji`、`#EC662D`、`border-radius:` >0（圓鈕除外）、`box-shadow` 全空；`↑/↓` 於 free-checkup 元件系為空。
- Playwright 三斷點（1280 / 768 / 390）更新 `checkup-tokens-visual.spec.ts` 快照 ＋ 既有 `freecheckup-card-a11y.spec.ts` / `freecheckup-sparkline-signs.spec.ts` / `holdings-detail-panel-*.spec.ts` 綠燈。
- `bunx tsgo --noEmit -p tsconfig.app.json` 綠；`bunx vitest run` 主要單元測試綠。

---

## 執行順序建議
0 → 1 → 2 → 3 → 4 → 5 → 6 → 7；每階段完成後做 typecheck 與該階段 e2e 快照更新，避免尾段一次爆表。

## 不動範圍
- 資料層 hooks（`useAppRuntimePortfolioDerivedData`、`useExpertHoldingsBundle` 等）、`computeScenario`、analytics 事件名、Supabase edge functions、demo/示範資料流程。

## 建議一次交付 vs 分階段
本次改動範圍大（~15 個元件檔、5 個 tab、抽屜十區塊重排、tab 導覽收斂），建議**分 3 個 turn** 落實以避免單輪過大：
- Turn A：階段 0–3（tokens／導覽／Hero／今日待辦／產業分佈收尾）
- Turn B：階段 4–5（持倉卡 mobile 清單化 ＋ 抽屜十區塊重排）
- Turn C：階段 6–7（其他 4 tab 編輯化 ＋ 引導 ＋ RWD 驗收 ＋ 快照）

請確認：**是否照 A/B/C 三 turn 執行**，或要求「一次全做」（風險：diff 過大、快照可能一次要重跑十幾張）。
