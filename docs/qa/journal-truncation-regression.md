# 週記／訊號 richHtml 截斷回歸清單

最後執行：build-mode 靜態稽核 + Vitest（23/23 綠）
稽核指令：見底部「複驗指令」

## 憲法（單一事實來源）
- `PREVIEW_LIMITS` 定義於 `src/components/SafeRichHtml.tsx`
  - `cardTitle=80` / `cardSummary=220` / `listRow=140` / `dashboardRow=100` / `riskNoteShort=60` / `learningPointsCard=500` / `learningPointsPreview=1000`
- **列表／卡片／背景** 一律 `richHtmlPreview(x, PREVIEW_LIMITS.<key>)`；禁止裸魔數
- **詳情／展開／預覽 dialog** 一律 `richHtmlToPlain(x)` 或直接 `<SafeRichHtml html={x}>`（無 `clamp` / 無 `line-clamp-*`）

## 全域靜態掃描
| 檢查 | 指令 | 結果 |
|---|---|---|
| 產品碼中無裸魔數 `richHtmlPreview(x, 123)` | `rg -n "richHtmlPreview\([^)]*,\s*\d+\s*\)" src` | ✅ 僅 `src/test/unit/SafeRichHtml.test.ts` 命中（測試斷言本身，非產品碼） |
| 詳情頁 / 預覽 dialog 未誤用 `richHtmlPreview` | `rg -n "richHtmlPreview" src/pages/app/JournalDetail.tsx src/pages/_signalEditor/JournalPreviewDialog.tsx` | ✅ 0 命中 |
| 單元測試 | `bunx vitest run src/test/unit/SafeRichHtml.test.ts` | ✅ 23/23 pass |

---

## 頁面逐項稽核

### 1. `src/components/JournalCard.tsx`（週記卡片）
| 欄位 | Line | 呼叫 | 常數 | CSS clamp | A規則 | B常數 | C視覺 | D不截斷 |
|---|---|---|---|---|---|---|---|---|
| reason_summary（週標題） | 41 | `richHtmlPreview(..., PREVIEW_LIMITS.cardTitle)` | 80 | —（純標題，字數 80 內足夠） | ✅ | ✅ | ✅ | n/a |
| reason_detail（週摘要） | 43 + 94 | `richHtmlPreview(..., PREVIEW_LIMITS.cardSummary)` | 220 | `line-clamp-3` | ✅ | ✅ | ✅ 220 字 ≈ 3 行 | n/a |
| learning_points | 47 | `richHtmlPreview(..., PREVIEW_LIMITS.learningPointsCard)` | 500 | —（依原本折行） | ✅ | ✅ | ✅ | n/a |

### 2. `src/pages/app/Signals.tsx`（訊號列表）
| 欄位 | Line | 呼叫 | 常數 | CSS clamp | A | B | C | D |
|---|---|---|---|---|---|---|---|---|
| reason_summary | 134 | `richHtmlPreview(..., PREVIEW_LIMITS.listRow)` | 140 | `line-clamp-2` | ✅ | ✅ | ✅ 140 字 ≈ 2 行 | n/a |
| risk_notes | 138 | `richHtmlPreview(..., PREVIEW_LIMITS.riskNoteShort)` | 60 | 短提示 badge | ✅ | ✅ | ✅ | n/a |

### 3. `src/pages/app/SignalsDashboard.tsx`（訊號儀表板）
| 欄位 | Line | 呼叫 | 常數 | CSS clamp | A | B | C | D |
|---|---|---|---|---|---|---|---|---|
| reason_summary | 133 | `richHtmlPreview(..., PREVIEW_LIMITS.dashboardRow)` | 100 | `line-clamp-1` | ✅ | ✅ | ✅ 100 字單行截斷 | n/a |

### 4. `src/pages/_adminSignals/SignalRow.tsx`（後台訊號 row）
| 欄位 | Line | 情境 | 呼叫 | 常數 | CSS | 檢查 |
|---|---|---|---|---|---|---|
| reason_summary（收合列） | 84 | 收合 | `richHtmlPreview(..., PREVIEW_LIMITS.cardTitle)` | 80 | `truncate` 單行 | ✅ A/B/C |
| reason_summary（展開） | 187 | 展開 | `<SafeRichHtml html=…>` | — | 無 clamp | ✅ D |
| reason_detail（展開） | 193 | 展開 | `<SafeRichHtml html=…>` | — | 無 clamp | ✅ D |
| risk_notes（展開） | 199 | 展開 | `<SafeRichHtml html=…>` | — | 無 clamp | ✅ D |
| learning_points（展開） | 205 | 展開 | `<SafeRichHtml html=…>` | — | 無 clamp | ✅ D |

### 5. `src/pages/_signalEditor/JournalPreviewDialog.tsx`（編輯器預覽）
| 欄位 | Line | 呼叫 | CSS | D 不截斷 |
|---|---|---|---|---|
| overallSummary（純文字探測） | 40 | `richHtmlToPlain(sanitizeRichHtml(...))` | — | ✅（僅拿來判空） |
| overallSummary（渲染） | 95 | `<SafeRichHtml html={overallSummary} />` | 無 clamp | ✅ |
| trade.reasonSummary | 141 | `<SafeRichHtml html=… className="text-xs" />` | 無 clamp | ✅ |
| trade.reasonDetail | 149 | `<SafeRichHtml html=… className="text-xs" />` | 無 clamp | ✅ |
| trade.riskNotes | 157 | `<SafeRichHtml html=… className="text-xs" />` | 無 clamp | ✅ |
| learningPoints（純文字探測） | 44 | `richHtmlToPlain(sanitizeRichHtml(...))` | — | ✅（判空） |
| learningPoints（渲染） | 179 | `<SafeRichHtml html={learningPoints} />` | 無 clamp | ✅ |

### 6. `src/pages/app/JournalDetail.tsx`（週記詳情）
| 欄位 | Line | 呼叫 / 渲染 | 規則 | 檢查 |
|---|---|---|---|---|
| reason_summary（週標題 flatten） | 174 | `richHtmlToPlain(signal.reason_summary)` | 詳情用 `ToPlain`（無截斷） | ✅ |
| 標題折疊 | 224–237 | `line-clamp-2` 僅在 `!titleExpanded && isTitleLong (>80)` 生效；`textContent` 完整未截斷；「顯示全部／收合」toggle | 只影響視覺、不截字 | ✅ |
| reason_summary（trade 明細展開） | 78 | `<SafeRichHtml html=…>` | 無 clamp | ✅ |
| reason_detail（trade 明細展開） | 86 | `<SafeRichHtml html=…>` | 無 clamp | ✅ |
| risk_notes（trade 明細展開） | 94 | `<SafeRichHtml html=…>` | 無 clamp | ✅ |
| reason_detail（本週整體摘要） | 248 | `<SafeRichHtml html=…>` | 無 clamp | ✅ |
| learning_points | 179 | `richHtmlToPlain(...).split(...)` 條列 | 完整無截斷 | ✅ |

---

## 覆蓋度自檢（"這份清單漏了什麼？"）
- ✅ 所有匯出 `richHtml*` 呼叫都被列出（rg 全域交叉比對）
- ✅ 所有 `<SafeRichHtml>` 呼叫都列出並確認詳情頁未帶 `clamp` prop
- ✅ 詳情頁的 `line-clamp-2` 僅存在於 JournalDetail 標題（且不截字，僅視覺折）
- ✅ 單元測試已鎖住呼叫端規則（`src/test/unit/SafeRichHtml.test.ts` 的 D 段靜態掃描）
- ✅ E2E `e2e/journal-detail-title-collapse.spec.ts` 覆蓋 30/80/300/800 字 4 種長度 × 詳情頁展開收合

## 結論
6 頁 × 全部欄位 × A/B/C/D 四項全數 ✅。目前產品碼無違規；`SafeRichHtml.test.ts` 的靜態斷言 + `journal-detail-title-collapse.spec.ts` 的 E2E 已把此清單機械化——未來任一呼叫端違反憲法會直接紅燈。

## 複驗指令
```bash
# 1. 靜態
rg -n "richHtmlPreview\([^)]*,\s*\d+\s*\)" src           # 只該在 test 檔命中
rg -n "richHtmlPreview" src/pages/app/JournalDetail.tsx \
                        src/pages/_signalEditor/JournalPreviewDialog.tsx  # 0 命中

# 2. 單元
bunx vitest run src/test/unit/SafeRichHtml.test.ts

# 3. E2E
bunx playwright test e2e/journal-detail-title-collapse.spec.ts
```
