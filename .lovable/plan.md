
# 持倉看板深掃 Bug 修復（第三輪 · 邏輯/效能/漏掃憲法）

窮舉 8 個核心元件（HoldingsPanel/Table/Workbench/Card/QuotaMeter/FilterBar/DetailPanel/MetaReportModal），發現 9 個實質 bug（含 1 個上一輪設計漏掃）。

## 修正清單

### B1｜受控 input 用 `||` 誤吞 0（邏輯 bug）
- 檔案：`src/checkup/components/holdings/HoldingsTable.jsx`
- 現況 L287：`value={holding.targetPrice || ''}`；L303：`holding.targetPrice && holding.price && ...`
- 修法：`value={holding.targetPrice ?? ''}`；L303 條件改 `holding.targetPrice != null && holding.price != null`

### B2｜分佈統計出現 "undefined" key（資料 bug）
- 檔案：`src/checkup/components/holdings/HoldingsPanel.tsx`
- 現況 L217-222 / L224-229：`periodMap[m.period]`、`posMap[m.position]` 未擋 undefined
- 修法：`if (!m || !m.period) return;` 與 `if (!m || !m.position) return;`

### B3｜warnings O(n²) 掃描 + 重複計數（效能 bug）
- 檔案：`src/checkup/components/holdings/HoldingsPanel.tsx`
- 現況：L231 warnings、L268 industry labels、L306 warning 字串 都各自跑 `holdings.filter(item => ...==ind).length`
- 修法：`PortfolioHealthCheck` 頂端建 `indCountMap = new Map()`（同 loop 內累計），全部 count 改讀 map

### B4｜derived 值未 memoize（效能 bug）
- 檔案：`src/checkup/components/holdings/HoldingsPanel.tsx`
- 現況：`PortfolioHealthCheck` 的 indMap/stratMap/periodMap/posMap、`Top5Holdings.top5` 每 render 都重算
- 修法：全部包 `useMemo(() => {...}, [holdings])`；引入 `useMemo` from 'react'

### B5｜排序遇 NaN 不穩定（邏輯 bug）
- 檔案：`src/checkup/components/holdings/HoldingsTable.jsx`
- 現況 L422-425：`aVal < bVal ? -1 : aVal > bVal ? 1 : 0`，NaN 全 false 導致亂序
- 修法：數值分支改 `(Number.isFinite(aVal) ? aVal : (sortDir==='asc' ? Infinity : -Infinity))` 後直接相減；string 分支保留 `<`/`>`

### B6｜DetailPanel ROI 主字違反 DESIGN_SPEC §2（上一輪漏掃）
- 檔案：`src/checkup/components/freecheckup/HoldingsDetailPanel.tsx`
- 現況 L465：`fontSize: 'clamp(36px, 7vw, 52px)'`；L469：`fontSize: 20`
- 修法：主字改 `fontSize: 22`；% 尾字改 `fontSize: 12`；`letterSpacing` 保 `-0.03em → -0.01em`
- 註：需一併檢查 e2e `holdings-detail-panel-wide.spec.ts` 若對主字有硬斷言，同步更新

### B7｜thesisSentence useMemo deps 為 object（效能 bug）
- 檔案：`src/checkup/components/freecheckup/HoldingsDetailPanel.tsx`
- 現況 L207-212：`useMemo(..., [dec, meta])`
- 修法：改為 `[dec?.actionText, meta?.strategy]`

### B8｜Modal saving 中仍可 close（UX / 錯誤 bug）
- 檔案：`src/checkup/components/freecheckup/HoldingMetaReportModal.tsx`
- 現況：L146-159 ESC 直接呼叫 `stableOnClose`；L192 backdrop `onClick={onClose}`
- 修法：
  - `stableOnClose` 包 `if (saving) return;`（改用 ref 讀 saving 最新值）
  - Backdrop `onClick={() => { if (!saving) onClose(); }}`
  - 取消按鈕 `disabled={saving}`

### B9｜lastAction 排序遇 invalid date NaN 亂序（邏輯 bug）
- 檔案：`src/checkup/components/freecheckup/HoldingsDetailPanel.tsx`
- 現況 L229-231：直接 `new Date(...).getTime()` 相減，date=null → NaN
- 修法：先 `map` 出 `{...r, _ts: Number.isFinite(new Date(r.date||r.tradeDate).getTime()) ? ... : 0}`，用 `_ts` 排序並過濾 `_ts>0`

## 不動範圍（明列，避免將來又被問）
- HoldingCard 錯誤 strip 紅（status semantic，可接受）
- HoldingsFilterBar chip `borderRadius:999`（豁免）
- HoldingsDetailPanel L760 segmented control borderLeft（功能性）
- HoldingsTable L432-435 useEffect ref sync 1-tick 延遲（實測正確）
- HoldingsDetailPanel L228 加碼 regex heuristic（非 bug）
- 事件/交易/日誌/預測分頁（DESIGN_SPEC §7 已知殘留）

## 驗證（強制窮舉）
1. Static rescan（同上一輪 rg 規則）於 8 檔，須 0 命中憲法違反
2. Unit：
   - `bunx vitest run src/test/unit/holdings-page.test.tsx src/test/unit/holdings-workbench-meta-source.test.ts src/test/unit/stock-meta-multi.test.ts src/test/holdingScenario.test.ts src/test/holdingsInSector.test.ts src/test/sectorFilterPresets.test.ts src/test/holdingExport.test.tsx`
3. E2E：
   - `bunx playwright test e2e/holdings-detail-panel-wide.spec.ts e2e/holdings-detail-panel-narrow.spec.ts e2e/holdings-meta-report-modal.spec.ts e2e/holdings-meta-report-modal-persist.spec.ts e2e/holdings-meta-report-modal-narrow.spec.ts e2e/freecheckup-card.spec.ts e2e/freecheckup-card-a11y.spec.ts e2e/holdings-override-price-recompute.spec.ts e2e/holdings-export-menu.spec.ts e2e/holdings-error-banner-a11y.spec.ts e2e/holdings-aria-live-sync-status.spec.ts`
4. 手動 Playwright：
   - B1：/holding-checkup 展開 row → target=0 輸入 → 確認保留
   - B6：截圖 DetailPanel ROI 於 375/640/1280，用 DOM 讀 fontSize ≤ 22px
   - B8：Modal 儲存中按 ESC → 確認不關且無 console warn

## 交付
- 4 個檔案 line-replace，無新檔案，無 schema/資料流變動
- 若 e2e 有硬斷言舊 ROI 大字或 targetPrice 空字串，同輪更新
