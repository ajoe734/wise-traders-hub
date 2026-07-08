
# 持倉看板全面 Bug 修復計畫（29 個問題，根因導向）

Subagent 全檔掃描 24 個持倉相關檔案後，共列出 **3 P0 / 8 P1 / 10 P2 / 8 P3** 共 29 個 bug。以下分四批交付，每批可獨立驗證、獨立回滾。

---

## Batch A（P0）— Crash／資料錯亂／a11y 阻塞

**A1 · HoldingsTab.tsx L451-458**｜「清除所有篩選」漏清 sectorFilter
- 根因：`onClearAll` 只重置 6 個 filter Set，忘了呼叫 `setSectorFilterPersisted({ items: [], mode: 'union' })`。
- 修法：補上該行呼叫。

**A2 · HoldingMetaReportModal.tsx L99-196**｜Modal 無 ESC／無 focus trap／無 body scroll lock
- 根因：只掛 `role="dialog"` 但沒有真正的鍵盤陷阱與 body lock，Tab 會逃出、ESC 無效、背景可捲動。
- 修法：新增 `useEffect` 做 (a) `body.style.overflow='hidden'` 及 cleanup、(b) `keydown` ESC → `onClose`、(c) 記錄 `previousActiveElement` 於 unmount 恢復、(d) 沿用 `HoldingsIntroVideo` 相同的 Tab/Shift+Tab 焦點陷阱邏輯。

**A3 · sectorFilterPresets.ts L64/72/91**｜Strict Mode 下 `write()` 被塞在 setState updater 內部，第二次執行造成 localStorage 與 state 不一致
- 根因：React 18 Strict Mode 會執行 updater 兩次；副作用 `write(next)` 應在 updater 外。
- 修法：`save/remove/rename` 改成先 `read()` → 計算 `next` → `write(next)` → `setPresets(next)`（一般 setState，非 functional updater）。

---

## Batch B（P1）— 功能 / 效能 / 憲法

**B1 · HoldingsDetailPanel.tsx L210-228**｜匯出期間 unmount → setState 警告與白屏
- 修法：新增 `isMountedRef`，`runExport` 的 `finally` 內 `if (isMountedRef.current) setExportNode(null)`。

**B2 · HoldingsDetailPanel.tsx L107**｜`valueNum` 為 NaN 傳染下游 `NaN%`
- 修法：以 `Number.isFinite` 判斷，改寫為顯式 fallback：
  ```
  const priceN = Number(h.price), qtyN = Number(h.qty);
  const valueNum = Number.isFinite(Number(h.value)) ? Number(h.value)
    : (Number.isFinite(priceN) && Number.isFinite(qtyN) ? priceN * qtyN : 0);
  ```

**B3 · HoldingsHero.tsx L37**｜render 期呼叫 `wbTone()` 造成 Concurrent tearing
- 修法：若為純函式 → 直接刪除；若為副作用 → 移入 `useEffect(() => wbTone(totalPnl), [totalPnl])`。

**B4 · HoldingsTable.jsx L396**｜每個 quote tick 都重跑 sort
- 修法：包 `useMemo(() => [...holdings].sort(...), [holdings, sortBy, sortDir])`。

**B5 · HoldingsDetailPanel.tsx L191-195**｜`stamp` 在 shareMode 開啟時定格，匯出時間錯
- 修法：移除 `useMemo`，改為 `runExport` 內呼叫 `makeStamp()`，作為 param 傳入 `HoldingExportCard`。

**B6 · HoldingsDetailPanel.tsx L250-252**｜`undo/redo` deps 引用不穩，鍵盤快捷鍵可能斷線
- 修法：新增 `undoRef/redoRef`，於一次性 `useEffect(...,[selected])` 使用 ref.current。

**B7 · HoldingsFilterBar.tsx L74-81**｜analytics `action` 判斷落後、且存在死碼 `trackFilter`
- 修法：先 `const action = set.has(val) ? 'remove' : 'add'` 再 `toggleSetItem`；刪除未使用的 `trackFilter`。

**B8 · HoldingCard.tsx L110 / HoldingExportCard.tsx L37**｜`h.price=0` 時 upside 計算保護不足
- 修法：改為 `Number.isFinite(priceN) && priceN > 0` 才計算。

---

## Batch C（P2）— UX / a11y / 樣式

**C1 · HoldingsSectorSummary.tsx L727**：`window.confirm` 改為 inline 二次確認（複用專案既有 `useAppConfirmationDialog` 或就地 2-step button）。
**C2 · HoldingsEmptyState / NoMatchState**：`onMouseEnter/Leave` 直接改 style → 改用 CSS class `:hover`（寫進 `holdingsTab.css`）。
**C3 · HoldingsQuotaMeter.tsx L75**：`useEffect` deps 補齊 `remain, limit`，移除 eslint-disable。
**C4 · HoldingsDetailPanel.tsx L889-897**：inline `<style>` @media 搬到 `holdingsDetailPanel.css`。
**C5 · HoldingsUploadSummary.tsx L39,50**：key 改用 `it.code || 'a-'+i`。
**C6 · Detail Panel Sort/Prefs/Export `<details>`**：改用 Radix DropdownMenu（或至少 ESC 收起 + 方向鍵）。
**C7 · HoldingsFooterBar.tsx L38-50**：按鈕補 `aria-haspopup="listbox" aria-expanded`。
**C8 · HoldingsTab.tsx L375**：IIFE 抽出為 `HoldingsWorkbench` 元件並 `useMemo(selected, [expandedDecision, displayed, sorted])`。
**C9 · HoldingCard.tsx L222/374**：移除 component 內部根元素的無效 `key` prop。
**C10 · HoldingMetaReportModal.tsx L119-215**：硬編碼色改 `WB.surface / WB.ink / WB.inkMute / C.down` token。

---

## Batch D（P3）— 可維護性（低優先，可延後）

D1 具名常數化 `STOP_LOSS_THRESHOLD=-8`、`TARGET_HIT_THRESHOLD=20`（`useHoldingDecision.js`）
D2 `HoldingsTable.jsx` `createElement as h` → JSX
D3 `HoldingsSectorSummary` saving `role="dialog"` → `role="form"`
D4 `theme.js` 為 `C.up/C.down` 加 Taiwan 憲法註解
D5 `HoldingsActionPriority` 按鈕補 `aria-label`
D6 `HoldingsDetailPanel` stamp 直接刪除 useMemo
D7 `useRouteHoldingsPage.js` ref-escape 註解升級
D8 `HoldingExportCard.tsx L127` 顯式 `Number()` 包裹

---

## 驗證清單

- [ ] `bun run typecheck` & `bun run build`
- [ ] `bunx vitest run src/test/sectorFilterPresets.test.ts src/test/holdingScenario.test.ts src/test/useSimHistory.test.ts src/test/holdingExport.test.tsx`
- [ ] `bunx playwright test e2e/freecheckup-card.spec.ts e2e/holdings-detail-panel-narrow.spec.ts e2e/holdings-detail-panel-wide.spec.ts e2e/holdings-export-menu.spec.ts e2e/holdings-override-price-*.spec.ts`
- [ ] 手動 A1：多選族群 → 加搜尋 → 卡片 0 → 點「清除所有篩選」→ 卡片全數回來
- [ ] 手動 A2：開啟 Meta Report Modal → 按 ESC 關閉、Tab 只在 modal 內循環、背景無法捲動、關閉後 focus 回到觸發按鈕
- [ ] 手動 A3：DEV 模式下連續儲存 3 個預設，reload 後仍是 3 個且順序正確
- [ ] 手動 B4：`/checkup` holdings 分頁開啟即時報價，DevTools Profiler 觀察 render < 8ms

## 需先釐清（Batch B 前補讀）
- `src/checkup/theme.js`：確認 `C.up=紅 / C.down=綠` 與 `WB.*` 齊備
- `src/pages/_freeCheckup/constants.jsx`：確認 `WB.inkSub` 定義
- `src/checkup/hooks/useSimHistory.ts`：確認 undo/redo 是否 `useCallback`（決定 B6 嚴重度）

## 不做 / 明確排除
- ❌ 不動業務演算法（`aggregateBySector`、`useHoldingsDerivations` 保持原樣）
- ❌ 不改 `holdingsStore.js` 的 hydration sentinel（已確認正確）
- ❌ 不改 `HoldingsPage.jsx` / ErrorBoundary 架構

## 給非技術讀者
1. **3 個 P0**：清除篩選按鈕會漏掉族群條件、回報 Modal 鍵盤與手機捲動有問題、DEV 模式下儲存預設會偶爾錯亂 — 先修。
2. **8 個 P1**：匯出時切換卡片會噴錯、缺值持倉會出 NaN%、即時報價卡頓、快捷鍵可能斷線 — 次修。
3. **P2/P3**：a11y、樣式 token、程式碼味道，分批清理。
