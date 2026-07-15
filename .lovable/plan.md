## 現況（實地截圖對比 §3.4）
- **卡片牆仍是舊版 S1**：`↑/↓` 箭頭、feature 黑卡（第一張大黑塊）、`IC 設計/AI 伺服器` 策略 tag、40px+ 大字 ROI、頁腳仍有 `↑ %`/`↓ %` 上下箭頭 — 全部違反 §3.4 定案。
- **產業分佈條**：五段全都墨色，第一段沒套 `--cm-accent`（規範第 1 名 accent，第 2–5 名墨階）。
- **今日待辦** OK。
- 之前 plan.md 標「S1 ✅」是誤判：`HoldingCardHeader/Return/PriceTrack/Footer` 五個 `_ui/holdingCard/*` 子元件其實從未依 §3.4 改寫。

## 這輪要改的檔案（§3.4 + §3.3）

### A. 持倉卡（§3.4）
1. `HoldingCard.tsx`
   - 移除 `pnlArrow ↑/↓`、`isFeature/isFeatureSlot` 分岐與 feature 卡外殼 → 全部改用單一 `wb-card` 白底黑框（`1px solid var(--cm-hair)`；active/hover → `var(--cm-ink)`）。
   - `minHeight` 由 320 收斂到 200；padding 統一 `18px 20px 14px`。
   - 傳給子層：`actionLabel`（EXIT/REVIEW/HOLD）、`pctVal`、`pnlVal`、`todayPnl`、`priceValue`。
2. `_ui/holdingCard/HoldingCardHeader.tsx`
   - 一行：`serif 名稱 15px · 代號 10px mute` + 右側 `[出場/檢視]` 徽章（HOLD 不渲染）+ 產業 tag（10px、`--cm-fill` 底、無底 = 未分類不顯示）。
   - **刪除**：策略 tag、股數、sparkline（sparkline 只留在抽屜；hidden 契約仍保留在 DOM 但 `display:none`）。
   - 權證：判 `meta.instrumentType === 'warrant'` → tag 換透明底 + 虛線框 + 「權證 · 到期 X 月」；≤1 月轉 accent。
3. `_ui/holdingCard/HoldingCardReturn.tsx`
   - 大字 ROI 從 40px+ → **18–20px**、`+`/`−`（U+2212）取代 ↑/↓；正 accent/500、負 `--cm-loss`/400。
   - 下方新增 **報酬條**：軌 `--cm-fill` 高 8px；`|pct|/40` 為長度；正由左、負由右；`|pct|>40` 條拉滿 + 右上 `▸` accent。
4. `_ui/holdingCard/HoldingCardPriceTrack.tsx`
   - 1px 髮絲線橫軸；成本 = 1px 灰刻度、現價 = 8px 圓點（正 accent／負 `--cm-loss`）；下方 `成本 X ｜ 現價 Y` 10px 標籤級。
   - **刪除** 決策摘要行（已移到抽屜）。
5. `_ui/holdingCard/HoldingCardFooter.tsx`
   - 頁腳只留一行：`今日 +423 ｜ 市值 9,457`（髮絲線隔開）。
   - **刪除**：目標價、upside、報價來源徽章（移到抽屜 title）。
6. `HoldingsWorkbench.tsx`
   - 刪 `isFeatureSlot` prop 與相關 grid 邏輯；`.holdings-card-grid` 全部同尺寸卡。
7. `styles/holdingsTab.css`
   - 刪 `.wb-card-feature` 相關 override；`.wb-roi` 字級 clamp 上限降到 22px（覆蓋 320/380/560 media-query 三段）。

### B. 產業分佈（§3.3 收尾）
8. `HoldingsSectorSummary.tsx`
   - 條帶第 1 名色改 `var(--cm-accent)`；第 2–5 名維持墨階；其餘合併 `--cm-hair`。
   - 檢查目前是否已經是這順序，如果只是 CSS 覆蓋就只改變數。

## 驗收
- `bunx tsgo --noEmit -p tsconfig.app.json` 綠。
- Playwright 三斷點截圖（1280/768/390）比對：
  - 卡牆無 ↑/↓、無黑底 feature 卡、ROI ≤ 22px、可見報酬條、頁腳一行。
  - 產業條第 1 段為 `#FF4D1F`。
- `rg -n "wb-card-feature|pnlArrow|↑|↓" src/checkup/components/freecheckup/` 為空。
- 既有 e2e：`freecheckup-card-a11y.spec.ts`、`freecheckup-sparkline-signs.spec.ts` 至少型別編譯 OK；視覺快照將在下一輪 update-snapshots。

## 不動範圍
- HoldingCard 的 a11y label、Sync overlay/Error strip/SR status 保留原樣。
- 抽屜、上傳 modal、事件頁、DailyTab/LogTab 本輪不動。
- Analytics `checkup_holding_expand` 事件保留。
