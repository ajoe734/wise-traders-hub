
# 個股抽屜優化：從「資訊面板」升級為「可分享的一頁紙」

## 現況問題（我看到的）

目前 `HoldingsDetailPanel.tsx` 內容只有 7 塊：頂部 nav、code/name、PnL 大數、DECISION 黑盒、急迫度五點、TARGET 進度條、事件時程、研究筆記按鈕。問題：

1. **沒有截圖的「畫面焦點」**：頂部 nav `< > ×` 和「持倉細節」灰字會跟著被截進去，破壞美感。
2. **資訊密度被壓在中段**：成本/現價/數量、買進日、持有天數、波段最高/最低、目前佔比、產業 thesis 全都散落在卡片或根本沒出現。
3. **缺少「故事性」**：沒有買進理由 vs 現況對照、沒有 thesis 句、沒有迷你價格走勢圖。讀者截圖貼到 LINE / 社群時看不出「為什麼這檔有戲」。
4. **品牌缺席**：截圖完全沒有 legendflow 浮水印與日期戳，分享出去無法回流。

## 優化方向

### 一、資訊架構重整（一頁紙九宮格）

抽屜寬度維持現狀，但內容重排為三層：

```text
┌─────────────────────────────────────────┐
│ [Share Mode 切換]              [‹ ›][×] │  ← 操作層（截圖時自動隱藏）
├─────────────────────────────────────────┤
│ 2330 台積電  ·  半導體 / 護國神山      │  ← 識別層
│ ████████████████  Sparkline 30D ████   │
│                                         │
│  +18.42%          DECISION              │  ← 焦點層
│  +92,100          ─────────             │
│  VALUE 591,200    HOLD                  │
│  ────────────     論點完整 · 信心高     │
│  成本 535 → 633   急迫度 ●●○○○         │
├─────────────────────────────────────────┤
│ 持有 42 天  ·  佔比 18%  ·  買進 9/15  │  ← 脈絡層
│ 區間 512 ─ 658   目標 720 (+13.7%)     │
│                                         │
│ THESIS                                  │
│ "AI 伺服器拉貨延續到 Q2，先進製程       │
│  漲價已落地。"                          │
│                                         │
│ NEXT EVENT  · 4/18                      │
│ Q1 法說會，看 HPC 營收與 CoWoS 產能     │
├─────────────────────────────────────────┤
│ legendflow.tw  ·  2026/06/27 14:32     │  ← 浮水印（截圖時顯示）
└─────────────────────────────────────────┘
```

新增欄位（資料皆已存在 holdings / decisions / events，不用改 schema）：
- 持有天數（從 `h.openDate` 算）
- 部位佔比（`h.value / totalValue`）
- 區間高低（從 `sparkData` 取 min/max）
- THESIS 句（取 `dec.thesisText` 或 `dec.actionText` 第一句）
- NEXT EVENT 卡（從 `relatedEvents[0]` 升級為獨立區塊，含日期 chip）
- 迷你 30D Sparkline（卡片上的 60×20 放大為 280×60，疊買進點與成本線）

### 二、截圖分享模式（核心新功能）

抽屜右上新增 **「分享」按鈕**（Camera icon），點下後：

1. **進入 Share Mode**：頂部 nav、× 按鈕、研究筆記按鈕全部 fade out。
2. **顯示浮水印**：底部出現 `legendflow.tw · 日期時間` 細字。
3. **背景升級**：抽屜背景由 `WB.surface` 換成有微紋理的卡紙色（已有 `--jh-*` token 可用）。
4. 三個選項：
   - **下載 PNG**：用 `html-to-image` 把抽屜 DOM 轉 PNG，命名 `2330-台積電-20260627.png`。
   - **複製到剪貼簿**：同上但寫進 `navigator.clipboard.write`。
   - **退出 Share Mode**：恢復操作 UI。

寬度固定 420×600（IG/LINE 友善比例），不再隨側欄變動。

### 三、視覺收斂

- **PnL 數字**：維持 48px，但加上日內變化小字（`+1.24% today`）。
- **DECISION 黑盒**：縮成 inline 卡，與 PnL 並排，避免吃掉太多直向空間。
- **THESIS / NEXT EVENT** 用 Kore-eda 風格的細邊框 + serif 引號，提升「值得截圖」的質感。
- 全程套 `WB.*` token，無 hardcoded 色。

## 技術細節（給工程確認）

**檔案異動範圍**
- `src/checkup/components/freecheckup/HoldingsDetailPanel.tsx`：重寫版面與分區
- 新增 `src/checkup/components/freecheckup/HoldingShareCard.tsx`：截圖模式專用容器（包浮水印 + 固定寬高）
- 新增 `src/checkup/hooks/useHoldingShareExport.ts`：封裝 `html-to-image` 的下載 / 複製邏輯
- `package.json`：新增 `html-to-image`（~10KB gz，無其他依賴）
- `src/pages/_freeCheckup/constants.jsx`：補 WB.thesis / WB.eventChip 兩個 token（如需）

**資料來源（全部已在 props，不打新 RPC）**
- `selected.openDate`、`selected.value`、`selected.qty`、`selected.cost`、`selected.price`
- `decisionsMap[code]`：thesisState、confidence、actionText、urgency
- `targets[code]` + `avgTarget()`：目標價與 upside
- `normalizedEvents`：取最近一筆 relatedEvents
- 新增 prop：`totalPortfolioValue`（算佔比用，從 `HoldingsTab` 父層傳入）
- 新增 prop：`sparkData30D`（已有 spark 資料就重用，否則 fallback 7D）

**截圖實作要點**
- 用 `html-to-image` 的 `toPng({ pixelRatio: 2, backgroundColor: WB.surface })` 確保 retina 解析度。
- Share Mode 用 React state 切，不破壞原本互動。
- iOS Safari 的剪貼簿限制：fallback 為下載。

**RWD**
- 桌面側欄：維持現有 380px 寬，內容重排。
- 手機：抽屜為全螢幕 modal，Share Mode 仍輸出 420×600 PNG（用離螢幕 render，不受手機螢幕寬度影響）。

**測試**
- 補 `e2e/freecheckup-holding-share.spec.ts`：點分享 → 截圖模式 → 下載 PNG → 檔名與尺寸驗證。
- Vitest：`HoldingsDetailPanel` 的新欄位 render 快照（含 thesis、持有天數、佔比）。

## 不做的事

- 不改抽屜開啟/關閉行為與 keyboard shortcut。
- 不動 HoldingCard（卡片本身已經夠資訊密度）。
- 不接 AI 生成 thesis（直接用 `dec.thesisText`，留待後續批次）。
- 不做動畫進場（Kore-eda 風格保持安靜）。

---

實作前我會再開一輪 design directions（用實際截圖當 reference）讓你挑三種版面配置 — 例如「九宮格密集」「上下兩段大留白」「卡紙質感雜誌風」，再進 build。
