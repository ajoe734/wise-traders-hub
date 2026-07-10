## 目標
在 `JournalDetail` 頁面加入「匯出 PDF」按鈕，一鍵產出 A4 直式、legendflow 品牌調性的「編輯月刊風」週記 PDF。純前端產生，不需 Edge Function。

## 排版設計（A. Editorial Magazine）

### 全域規範
- **紙張**：A4 直式（210×297mm），四邊 margin 18mm
- **色票**：Source Serif 4（標題）+ Noto Sans TC（內文）；主色 `#EC662D`、墨色 `#292520`、背景 `#F5F3EF`、輔助灰 `#8A857C`、分隔線 `#E4DFD6`
- **裝飾**：無陰影、無漸層；僅使用 1px hairline 分隔線與品牌橘點 `•`

### Page 1 — 封面
```text
┌──────────────────────────────┐
│ legendflow·                  │  ← 12pt wordmark 左上
│                              │
│                              │
│   WEEK 24                    │  ← 10pt tracking-wide 灰字
│   06/09 — 06/13              │
│                              │
│   本週操作                    │  ← 60pt Source Serif 4
│   回顧與覆盤                  │     壓在頁面上緣區
│                              │
│   ─────────────              │  ← 40mm hairline
│                              │
│   {weekTitle}                │  ← 18pt italic serif，最多 3 行
│                              │
│                              │
│                    [avatar]  │  ← 右下：頭像 24mm 圓
│                    王大明     │  ← 14pt
│                    實戰導師   │  ← 10pt 灰
└──────────────────────────────┘
```

### Page 2+ — 本週整體摘要 + 操作列表（兩欄式）
```text
┌──────────────────────────────┐
│ 本週操作回顧 · WEEK 24        │  ← 頁眉 9pt 灰
├──────────────────────────────┤
│                              │
│ 本週整體摘要                  │  ← 24pt serif section title
│ ────                         │
│ {reason_detail 純文字}        │  ← 11pt/1.7 兩欄流排
│                              │
│ ──────────────────           │
│                              │
│ 本週操作                      │  ← 24pt serif
│                              │
│ ┌── 窄欄 30% ──┐┌ 寬欄 70% ┐│
│ │ [BUY]        ││ 為什麼   ││
│ │ 2330         ││ 這樣操作 ││
│ │ 台積電       ││ ……       ││
│ │ 06/10        ││          ││
│ │ 價 850       ││ 部位控管 ││
│ │ 5 張         ││ ……       ││
│ │              ││          ││
│ │              ││ ⚠風險    ││
│ │              ││ ……       ││
│ └──────────────┘└──────────┘│
│ ─────────────── (hairline)   │
│ (下一筆 signal…)              │
└──────────────────────────────┘
                          — 2 —  ← 頁碼底部置中，橘點分隔
```
- 每筆 signal 之間 12mm 空白 + 1px hairline
- Action badge 用實色方塊：BUY 紅、SELL 綠（台灣慣例）、HOLD 灰
- 若一筆 signal 分頁被切開，強制帶新頁（`page-break-inside: avoid`）

### 末頁 — 本週學習重點
```text
│ 本週學習重點                  │  ← 24pt serif
│                              │
│ •  {point 1}                 │  ← 橘點 bullet + 13pt 內文
│ •  {point 2}                 │
│ •  ……                        │
│                              │
│                              │
│ ─────                        │
│ legendflow · 週記由 legendflow │  ← 頁尾版權列 9pt 灰
│ 產出　{today YYYY/MM/DD}      │
```

## 技術實作

### 依賴
- 安裝：`jspdf`（純向量 PDF 引擎） + `html2canvas-pro`（支援 oklch/現代 CSS 顏色）
- 為何不用純 jsPDF `.html()`：導師內文含 `<SafeRichHtml>` 已渲染的 HTML，用 html2canvas 抓 DOM 節點最忠實
- 為何不用瀏覽器 `window.print()`：無法保證封面版式、頁碼、頁眉一致，且會被會員介面 layout 汙染

### 檔案
1. **`src/lib/exportJournalPdf.ts`（新）**
   - `exportJournalPdf(signal, weekSignals, weekRange)`：
     - 建立離屏 `<div id="pdf-render-root">`（絕對定位 -9999px），寬 210mm
     - 依上述三段版型渲染三個 `.pdf-page` 節點（A4 高度 297mm、`overflow: hidden`）
     - 用 `html2canvas` 逐頁 canvas → `jsPDF.addImage`（scale 2、jpeg 0.92 壓縮）
     - `doc.save(週記_{expertSlug}_{YYYY-MM-DD}.pdf)`
     - 完成後移除離屏節點
2. **`src/pages/_journalPdf/JournalPdfDocument.tsx`（新）**
   - React 元件，接收 signal / weekSignals / weekRange，輸出上述三段 A4 版型
   - 使用內嵌 style（避免 Tailwind purge / dark mode 汙染）
   - 字型：`@import` Google Fonts 由 `useEffect` 動態注入並等 `document.fonts.ready`
3. **`src/pages/app/JournalDetail.tsx`（改）**
   - `ShareButton` 旁新增 `<Button variant="outline" size="sm">` 匯出 PDF 按鈕
   - 點擊 → `setIsExporting(true)` → 呼叫 `exportJournalPdf` → 完成 toast
   - 匯出中按鈕顯示 `<Loader2 animate-spin>` + 「產生中…」，`disabled`

### 分頁演算法
- 摘要與 signal 列表使用「量測後分頁」：
  - 先把所有 signal 依序放進第 2 頁
  - 每放一筆量測目前頁高，若 > 260mm 則 flush 該頁、開新頁繼續
- 學習重點永遠獨立新頁（除非只有 1-2 條可與最後一頁合併）

### Toast/UX
- 開始：`toast.info('產生 PDF 中…')`
- 成功：`toast.success('已匯出週記 PDF')`
- 失敗：`toast.error('匯出失敗，請重試')` + `console.error`

## 驗收
1. 點擊「匯出 PDF」→ 3-5 秒內下載檔案
2. 開啟 PDF：
   - 封面版式與設計稿一致，頭像不變形
   - 摘要與操作列表分頁乾淨，signal 不會被切一半
   - 學習重點分行正確，橘點對齊
   - 頁眉/頁碼每頁都在
3. 中文字型完整渲染（不出現方框）
4. 檔名含專家 slug 與週起日
5. 匯出中按鈕鎖定，avoid 重複點擊
6. 短內容（1 筆 signal、無學習重點）與長內容（10+ signals、每筆超長 HTML）皆可正常匯出（Playwright 兩個情境驗證）

## 不做的部分
- 不做 Server-side PDF（暫用前端即可，未來若要 email 附件再改 Edge Function 版）
- 不做多語系（只出繁中）
- 不改動 `JournalDetail` 頁面本身的內容排版，只加匯出按鈕
