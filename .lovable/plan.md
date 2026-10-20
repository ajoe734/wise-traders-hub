# 修復：會員週記「本週教學重點」被壓成一整坨文字

## 已查證的根因
會員週記詳情頁（`/app/journal/:id`）的「本週教學重點」不是用富文本顯示，而是：
1. 先用 `richHtmlToPlain()` 轉純文字 —— 這個函式會把所有空白與換行 `\s+` 壓成一個空格；
2. 再用 `\n` 切成條列 —— 但換行早已被吃掉，所以永遠只剩一條。

結果：老師分段、編號、粗體、圖片全部消失，變成截圖那樣一個 `•` 後面一大段。
老師編輯器的「預覽」用的是 `SafeRichHtml` 直接渲染，所以老師看預覽正常、會員看到壞掉，兩邊不一致。

## 要做的修改
1. `src/pages/app/JournalDetail.tsx`：「本週教學重點」改為逐筆以 `SafeRichHtml` 渲染每個 signal 的 `learning_points`（空的用 `isRichHtmlEmpty` 過濾，保留只有圖片的內容），與編輯器預覽同一套渲染；多筆之間用分隔線，不再加假的 `•`。
2. PDF 匯出的 `learningPoints` 改成保留段落：抽出純函式 `learningPointsToParagraphs(html)`（放 `_journalDetail/richHtml.ts`），以 `<p>/<br>/<li>/換行` 切段後各段再去頭尾空白，PDF 改用它，不再整段壓扁。
3. 窮舉同類問題並一併檢查：`JournalCard.tsx`（卡片預覽本來就是摘要，保持單行截斷，不改）、`WarRoomSection.tsx`、`MobileCarousels.tsx`（首頁預覽，確認是否同樣壓扁；只是預覽摘要則不改）、`JournalPreviewDialog.tsx`（已正確）。另掃 `JournalDetail.tsx` 中其他用 `richHtmlToPlain` 再切行的欄位一併修正。

## TDD（紅→綠）
- Seam 1：`learningPointsToParagraphs`——輸入 `<p>一、A</p><p>二、B</p>`、`A<br>B`、純文字含 `\n` 三種，斷言回傳 2 段；先跑確認現行邏輯（壓扁後切行）回傳 1 段＝紅，再實作轉綠。
- Seam 2：Playwright 開會員週記詳情（真實會員 session），斷言「本週教學重點」區塊內有多個段落元素、且出現 `<img>` 時有渲染；並截圖 1280／390px 檢查無溢出。

## 驗收
- 截圖中那篇週記在會員端顯示成「一、目前持股觀察重點」「1.2492華新科…」等分段，與老師預覽一致。
- 相關 vitest、build 通過；正式站需發布前台才會生效（發布前會告知）。
