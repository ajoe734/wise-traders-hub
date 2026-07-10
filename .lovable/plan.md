## 目標
新增單元測試 `src/test/unit/SafeRichHtml.test.ts`，鎖定 `richHtmlPreview` / `richHtmlToPlain` / `PREVIEW_LIMITS` 行為，並抽樣驗證各呼叫端使用正確常數（防止未來有人把 `PREVIEW_LIMITS.cardTitle` 誤改為魔數）。

## 測試矩陣（不准偷懶清單）

### A. `richHtmlPreview(html, maxLen)` 純函式
| 案例 | 輸入 | 期望 |
|---|---|---|
| A1 | `null` | `''` |
| A2 | `undefined` | `''` |
| A3 | `''` | `''` |
| A4 | 純文字 `'hello'`, max=200 | `'hello'`（未截斷、無 …） |
| A5 | 純文字 20 字, max=10 | 前 10 字 + `…`（長度=11，最後一字為 …） |
| A6 | HTML `'<p>abc</p><p>def</p>'`, max=200 | `'abcdef'` 或 `'abc def'`（依 jsdom `textContent`；用 `toMatch` 允許中間 0-1 空白） |
| A7 | 含 `<strong>`, `<em>`, `<br>`, `<ul><li>` 的富文字 | 標籤全被剝除；不含 `<` |
| A8 | 前綴 `•` 或 `·` 的條列 `'• 第一項'` | 移除前綴，得 `'第一項'` |
| A9 | 多重空白 `'a  \n\t b'` | collapse 為 `'a b'` |
| A10 | 剛好等於 maxLen（邊界） | 不加 `…` |
| A11 | maxLen+1 | 截斷加 `…` |
| A12 | 使用預設 maxLen=200 呼叫（不傳） | 超過 200 才截斷 |

### B. `richHtmlToPlain(html)` 純函式（詳情頁用，不截斷）
| 案例 | 輸入 | 期望 |
|---|---|---|
| B1 | `null` / `undefined` / `''` | `''` |
| B2 | 5000 字純文字 | 完整回傳，長度=5000，不含 `…` |
| B3 | HTML `'<p><strong>粗</strong>字</p>'` | `'粗字'`，不含 `<` |
| B4 | `<br>` 分隔多段 | 空白正常 collapse，textContent 應完整 |
| B5 | `'• 條列前綴'` | 移除前綴 |
| B6 | 多空白 `'a\n\n\n b'` | `'a b'` |

### C. `PREVIEW_LIMITS` 常數凍結
凍結目前商業定義，避免無意識調整（若真要改需連測試一起改）：
```ts
expect(PREVIEW_LIMITS).toEqual({
  cardTitle: 80,
  cardSummary: 220,
  listRow: 140,
  dashboardRow: 100,
  riskNoteShort: 60,
  learningPointsCard: 500,
  learningPointsPreview: 1000,
});
```

### D. 呼叫端規則對齊（靜態原始碼檢查）
用 `fs.readFileSync` 讀原始碼、以 regex 斷言各檔案 `richHtmlPreview` 呼叫使用**具名常數**、不出現裸魔數：

| 檔案 | 欄位 | 應用常數 |
|---|---|---|
| `src/components/JournalCard.tsx` | reason_summary | `PREVIEW_LIMITS.cardTitle` |
| `src/components/JournalCard.tsx` | reason_detail | `PREVIEW_LIMITS.cardSummary` |
| `src/components/JournalCard.tsx` | learning_points | `PREVIEW_LIMITS.learningPointsCard` |
| `src/pages/app/Signals.tsx` | reason_summary | `PREVIEW_LIMITS.listRow` |
| `src/pages/app/Signals.tsx` | risk_notes | `PREVIEW_LIMITS.riskNoteShort` |
| `src/pages/app/SignalsDashboard.tsx` | reason_summary | `PREVIEW_LIMITS.dashboardRow` |
| `src/pages/_adminSignals/SignalRow.tsx` | reason_summary | `PREVIEW_LIMITS.cardTitle` |

外加反向斷言：
- `src/pages/app/JournalDetail.tsx` **不得**再出現 `richHtmlPreview(` 字樣（詳情頁一律用 `richHtmlToPlain`，防退化）
- `src/pages/_signalEditor/JournalPreviewDialog.tsx` 同上

作法：對每份檔案讀入為字串，用 `expect(source).toMatch(/richHtmlPreview\([^,]+,\s*PREVIEW_LIMITS\.<key>\)/)` 與 `expect(source).not.toMatch(/richHtmlPreview\([^)]*,\s*\d+\s*\)/)` 斷言沒有魔數。

## 檔案清單
- 新增：`src/test/unit/SafeRichHtml.test.ts`

## 執行方式
- `bunx vitest run src/test/unit/SafeRichHtml.test.ts`
- 已有 `vitest.config.ts` 與 `src/test/setup.ts`（jsdom 環境），無需額外設定；`htmlToPlainText` 走 `document` 路徑即可正確測試 HTML flatten。

## 驗收
- A/B/C/D 全部 pass
- 若之後有人：
  - 把 `richHtmlPreview(x, 80)` 改回魔數 → D 段紅燈
  - 動 `PREVIEW_LIMITS` 任一 key → C 段紅燈
  - 在 `JournalDetail` / `JournalPreviewDialog` 加回 `richHtmlPreview(` → D 段紅燈
  - 改壞 flatten / 截斷邏輯 → A/B 紅燈
