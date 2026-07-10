## 目標
建立一份可勾選的回歸清單 `docs/qa/journal-truncation-regression.md`，並實際逐頁做完靜態 + 執行時檢查，把結果直接寫進清單交付。

## 清單結構（每頁一節，含 4 欄）
| 欄位 | 呼叫位置 | 應用規則 | 檢查方式 |
|---|---|---|---|

## 頁面窮舉範圍（不准漏）
| # | 頁面 | 檔案 | 涉及欄位 |
|---|---|---|---|
| 1 | 週記卡片 | `src/components/JournalCard.tsx` | reason_summary / reason_detail / learning_points |
| 2 | 訊號列表 | `src/pages/app/Signals.tsx` | reason_summary / risk_notes |
| 3 | 訊號儀表板 | `src/pages/app/SignalsDashboard.tsx` | reason_summary |
| 4 | 後台訊號 row（收合/展開） | `src/pages/_adminSignals/SignalRow.tsx` | 收合列 reason_summary + 展開區四欄 SafeRichHtml |
| 5 | 編輯器預覽 dialog | `src/pages/_signalEditor/JournalPreviewDialog.tsx` | overallSummary / learningPoints / 每筆 reasonSummary/Detail/Risk |
| 6 | 週記詳情 | `src/pages/app/JournalDetail.tsx` | 標題 reason_summary（可折疊）/ reason_detail / risk_notes / learning_points |

## 每頁需驗證的斷點
對每個欄位執行下列 A–D 檢查並在清單打勾：
- **A. 呼叫規則**：符合 [統一憲法]
  - 列表/卡片/背景 → `richHtmlPreview(x, PREVIEW_LIMITS.<key>)`
  - 詳情/展開/預覽 → `richHtmlToPlain(x)` 或直接 `<SafeRichHtml html={x}>`
  - 禁止裸魔數
- **B. 對應常數正確**：對照下表
  | 欄位 / 情境 | 應用常數 |
  |---|---|
  | JournalCard.reason_summary | cardTitle (80) |
  | JournalCard.reason_detail | cardSummary (220) |
  | JournalCard.learning_points | learningPointsCard (500) |
  | Signals.reason_summary | listRow (140) |
  | Signals.risk_notes | riskNoteShort (60) |
  | SignalsDashboard.reason_summary | dashboardRow (100) |
  | SignalRow(收合).reason_summary | cardTitle (80) |
- **C. CSS 截斷輔助**：`line-clamp-N` / `truncate` 存在且與長度上限方向一致（不會出現字很長但沒 clamp、或 clamp 但沒截斷雙重截）
- **D. 詳情頁不截斷**：JournalDetail / JournalPreviewDialog / SignalRow 展開區的 `<SafeRichHtml>` 未帶 `clamp` prop 也沒有 `line-clamp-*` class

## 執行方式（實測部分）
1. **靜態掃描（自動化）**
   - `rg -n "richHtmlPreview\([^)]*,\s*\d+\s*\)" src` 應為 0 命中
   - `rg -n "richHtml(Preview|ToPlain)" src/pages/app/JournalDetail.tsx src/pages/_signalEditor/JournalPreviewDialog.tsx` 應無 `richHtmlPreview`
   - `bunx vitest run src/test/unit/SafeRichHtml.test.ts` 需全綠（既有 23 tests）
2. **執行時視覺驗證（Playwright，headless）**
   針對長度矩陣（30 / 80 / 140 / 300 / 800 字，含 HTML）分別走：
   - `/signals`（Signals 列表）：截圖確認 reason_summary 兩行 clamp、risk_notes 60 字以內
   - `/signals-dashboard` 或對應路由：reason_summary 單行 clamp
   - `/journals`（JournalCard 顯示週記）：標題 80、摘要 220 三行 clamp、learning_points 500
   - `/journal/:id`（JournalDetail）：標題完整＋顯示全部/收合切換；reason_detail 完整無 clamp
   - 後台 `/admin/signals`：收合列 truncate、點開後四欄完整渲染
   - 編輯器預覽 dialog：以 e2e 觸發後檢查 overallSummary / learningPoints / 每筆 reason 完整渲染
   每步截圖存 `/tmp/browser/journal-truncation/` 並 `code--view` 目視確認。
3. **結果落地**
   把每個項目在 `docs/qa/journal-truncation-regression.md` 打勾 ✅ / ❌ + 註記；有 ❌ 立刻補修並記錄改動檔。

## 檔案清單
- 新增：`docs/qa/journal-truncation-regression.md`
- 新增：`/tmp/browser/journal-truncation/` 底下截圖（不入庫）
- 若掃描/實測發現不一致：修對應 `.tsx` 至符合憲法

## 驗收
- 6 頁 × 所有欄位 × A/B/C/D 四項全數 ✅
- 靜態掃描 0 命中魔數、詳情頁 0 命中 `richHtmlPreview`
- Vitest 綠、Playwright 目視綠
- `docs/qa/journal-truncation-regression.md` 存檔，含每頁截圖路徑與檢查結果
