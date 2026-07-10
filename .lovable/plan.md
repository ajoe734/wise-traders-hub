## 目標
優化 `src/pages/app/JournalDetail.tsx` L221-240 的標題與「顯示全部／收合」按鈕：修正鍵盤可用性、視覺一致性、以及展開時版面跳動問題。

## 現況問題（L221-240）
1. **視覺不一致**：按鈕用裸 `<button>` + `text-xs text-mentor hover:underline`，未使用 shadcn `Button` variant，也缺 focus-visible 樣式（Tab 過去看不到焦點框）
2. **無圖示提示**：純文字「顯示全部／收合」缺少 ChevronDown/Up 圖示，無法一眼分辨方向
3. **版面跳動**：`line-clamp-2` → 展開後 `h1` 從 2 行變 N 行，下方 `Card` 突然被推下；收合又跳回，長文字時視覺閃爍
4. **點擊區小**：`text-xs` 純文字 tap target < 32px，未達 44px 建議
5. **ARIA 半套**：有 `aria-expanded` 但未關聯 `aria-controls` 指向被折疊的 `h1`
6. **無平滑過渡**：直接切換 class，無 transition

## 實作方案（僅動 JournalDetail.tsx L221-240 與相關 state）

### A. 版面不跳動
- 展開狀態不改變 `h1` 的最大高度突變。改用 `max-h` + `transition-[max-height]` 平滑過渡：
  - 收合：`max-h-[3.5rem] overflow-hidden`（約 2 行 `text-xl`）
  - 展開：`max-h-[60rem]`（足夠容納任何合理長度）
  - 加 `transition-[max-height] duration-300 ease-out`
- 保留 `line-clamp-2` 作為收合時的 ellipsis 呈現（`max-h` 只擋高度，`line-clamp-2` 給 `…`）
- 給 `h1` 加穩定的 `id="journal-week-title"` 供 `aria-controls`

### B. 按鈕升級
- 改用 shadcn `<Button variant="ghost" size="sm">` + 圖示：
  ```tsx
  <Button
    type="button"
    variant="ghost"
    size="sm"
    onClick={() => setTitleExpanded(v => !v)}
    aria-expanded={titleExpanded}
    aria-controls="journal-week-title"
    className="mt-1 h-8 px-2 -ml-2 text-xs text-mentor gap-1"
  >
    {titleExpanded ? (
      <><ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> 收合</>
    ) : (
      <><ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> 顯示全部</>
    )}
  </Button>
  ```
- `h-8` + `px-2` 給足 tap target，且視覺仍輕量
- shadcn Button 自帶 `focus-visible:ring` → 鍵盤 Tab 可見焦點
- 圖示 `aria-hidden`，文字承載語意

### C. 鍵盤操作驗證
- shadcn `Button` = 原生 `<button>` → Space/Enter 已支援
- Tab order：`h1` (非互動) → 按鈕 → ShareButton；不需 `tabIndex`
- `aria-expanded` + `aria-controls` 讓螢幕閱讀器宣告「已收合／已展開，控制 journal-week-title」

### D. 邊界處理
- `isTitleLong` 閾值維持 80（既有 E2E 已鎖定）
- 短標題時完全不渲染按鈕，也不套 `max-h`（維持自然高度）
- `weekTitle` 為空時 fallback「本週操作回顧」→ 不觸發折疊（長度 6，不 > 80）

## 檔案清單
- 編輯：`src/pages/app/JournalDetail.tsx`（僅 L221-240 區塊 + import 微調，Button 已有 import）

## 不變的部分
- `TITLE_COLLAPSE_THRESHOLD = 80`
- `richHtmlToPlain(signal.reason_summary)` flatten 邏輯
- 既有 E2E `e2e/journal-detail-title-collapse.spec.ts` 的 4 個案例仍應通過（selector 用 `line-clamp-2` 存在性 + 按鈕文字 `顯示全部/收合` + `h1.textContent` 完整性——本次改動都保留）

## 驗收
1. `bunx vitest run` 全綠
2. `bunx playwright test e2e/journal-detail-title-collapse.spec.ts` 4/4 綠（selector 未變動）
3. 手動 / Playwright 截圖：
   - 短標題頁：無按鈕、無 `max-h` 限制
   - 長標題頁：預設 2 行 + `…`，按鈕含 ChevronDown 圖示
   - 按 Tab 到按鈕：可見 focus ring
   - 按 Enter/Space：展開，圖示變 ChevronUp，`h1` 高度平滑增長不閃爍
   - 再按一次：平滑收合
4. `aria-expanded` / `aria-controls` 在 DOM 檢查存在且正確
