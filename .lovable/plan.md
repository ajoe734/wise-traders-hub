
# 持倉看板 DESIGN_SPEC 深掃修復（第二輪）

依 `src/checkup/DESIGN_SPEC.md` §2/§4/§5 憲法，掃描 8 個核心元件（HoldingsPanel/Table/Workbench/Card/QuotaMeter/FilterBar/DetailPanel/MetaReportModal），共 12 項未落地違反，逐項修正。

## 修正清單

### A. `src/checkup/components/holdings/HoldingsTable.jsx`
1. **L99** `borderRadius: 10` → `8`（§4 禁 >8px）
2. **L177** `fontSize: 32` → `22`（§2 禁 >22px；ROI% 為區塊唯一焦點）

### B. `src/checkup/components/holdings/HoldingsPanel.tsx`
3. **L41** Hero `borderRadius: 12` → `8`
4. **L61** 總損益 `fontSize: 28` → `22`（保 fontWeight:500）
5. **L157** 移除 `borderLeft: 1px solid amber`，保留 `alpha(C.amber,'04')` 底色 + `borderRadius: 4`
6. **L292** 同上，移除 warnings 條 `borderLeft: 2px`

### C. `src/checkup/components/freecheckup/HoldingsQuotaMeter.tsx`
7. **L31, L87** 兩處外框 `borderRadius: 10` → `8`
8. **L35** 移除 `animation: 'pulse 1.4s ease-in-out infinite'`（§4 keyframes pulse 已禁），改為靜態 `width: 30%` 灰條

### D. `src/checkup/components/freecheckup/HoldingCard.tsx`
9. **L136** shimmer `linear-gradient` 背景移除，改為 `background: alpha(WB.ink,'06')` + 透明度呼吸 keyframe（不含 gradient）
10. **L154** error strip `fontWeight: 600` → `500`；**L155** 硬編 `#c8362c` → `C.down`（跨 file 引入 checkup theme C）

### E. `src/checkup/components/freecheckup/HoldingMetaReportModal.tsx`
11. **L218** Modal 標題 `fontWeight: 700` → `500`

### F. `src/checkup/components/freecheckup/HoldingsDetailPanel.tsx`
12. **L448** 個股名 h2 `fontSize: 26` → `22`（SERIF/500 維持）

## 灰區（不動）
- `HoldingsDetailPanel.tsx:760` borderLeft：segmented control 欄位分隔（功能性），非裝飾。
- `HoldingsFilterBar.tsx:54` borderRadius:999：使用者已豁免。
- `HoldingsPanel.tsx:12` 註解中 boxShadow：僅文字說明。
- 事件/交易/日誌/預測分頁：DESIGN_SPEC §7 已列已知殘留，本次不動。

## 不動作範圍
- 不改資料流、不改元件 props、不改測試斷言邏輯。
- 不觸碰 `HoldingExportCard`（輸出海報自成一格）、FilterBar chip、非持倉分頁。

## 驗證
1. Static scan：修完再跑 `rg` 一輪 fontSize>22 / borderRadius>8 / borderLeft / linear-gradient / fontWeight:[67]00 / pulse 於上述 8 檔，須 0 命中（灰區除外）。
2. 單元/迴歸：
   - `bunx vitest run src/test/unit/holdings-page.test.tsx src/test/unit/holdings-workbench-meta-source.test.ts src/test/unit/stock-meta-multi.test.ts`
3. E2E：
   - `bunx playwright test e2e/freecheckup-card.spec.ts e2e/freecheckup-card-a11y.spec.ts e2e/holdings-detail-panel-wide.spec.ts e2e/holdings-detail-panel-narrow.spec.ts e2e/holdings-meta-report-modal.spec.ts e2e/holdings-meta-report-modal-narrow.spec.ts e2e/holdings-meta-report-modal-persist.spec.ts`
   - 若有 `holdings-error-banner-a11y.spec.ts` 對 error strip 顏色斷言，一併確認。
4. 視覺回歸：Playwright 375 / 560 / 1280 三斷點截 Hero / Table row / Card / QuotaMeter / DetailPanel h2 / Modal 標題。

## 交付
- 8 個檔案 line-replace，無新檔案。
- 若 E2E 對舊 `fontSize:32` / `fontWeight:700` 有硬斷言，同輪更新斷言與快照。
