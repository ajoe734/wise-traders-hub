## 一、審計結果（共 29 項 RWD 風險）

| 嚴重度 | 數量 | 摘要 |
|---|---|---|
| **P0** 橫向 scroll / CTA 被遮 | **5**（含 24 個後台 table） | Toast fixed 溢出 320px、後台 4–6 欄表格無 overflow wrapper、HoldingsDetailPanel Sandbox 4-col、Company Dashboard `grid-cols-3` 無 fallback |
| **P1** 擠壓難讀 | **19** | inline `1fr 1fr 1fr` / `repeat(4,1fr)` 無 media query、`fontSize:46/88` 無覆寫、nowrap CTA、三層 sticky 疊層、minWidth 硬寫死 |
| **P2** 美感瑕疵 | **5** | ExportCard 大字、ViewAsBanner 資訊在 <768 隱藏過多、浮層位移、Wordmark nowrap |

**前 5 大熱點檔案**
1. `HoldingsDetailPanel.tsx`（1 P0 + 3 P1 + 1 P2）
2. `pages/company/Dashboard.tsx`（1 P0 + 1 P1）
3. `freecheckup/EventsTab.jsx`、`HoldingsHero.tsx`、`pages/FreeCheckup.jsx`（各 2 P1）
4. `Toast.jsx`、`FunnelAnalytics.tsx` 單點 P0
5. `pages/company/*`（24 個 table 缺 `overflow-x:auto`）

**e2e 覆蓋缺口**：320–414 已覆蓋 HoldingCard；但 **560 / 768 / 1023** 全站無任何 spec；後台、ExpertDetail、Journal、Checkout 無 mobile 覆蓋。

---

## 二、4 階段改善計劃

### Phase 1 — P0 緊急止血（當天可上線）
**目標：消除所有橫向 scroll 與 CTA 遮擋**

1. **`Toast.jsx`**：container 改 `left:12; right:12; max-width:min(400px, calc(100vw - 24px))`，移除 `minWidth:300`。
2. **後台 24 個 `<table>` 批次包 wrapper**：統一抽 `<TableScroll>` 元件（`<div class="overflow-x-auto -mx-2 px-2">`），一次套用以下檔案：
   - `company/{AdSpend,ConversionCenter,ExpertRevenue,RoasLtv,OpsHealth,AuditLogs,Subscribers,SystemJobs,PerfMetrics,LinePushHistory,CheckupUsage,PaywallAnalytics,FunnelAnalytics}.tsx`
   - `_companyRevenue/*Tab.tsx`、`_adminPerformance/*Tab.tsx`、`_adminSignals/SignalsTable.tsx`、`_companyAnalysts/AnalystsTable.tsx`、`_backtestMonitor/*`、`_signalEditor/CapitalPanel.tsx`、`components/strategy/PeriodPerformanceTable.tsx`
3. **`HoldingsDetailPanel.tsx:791` sandbox stats**：`repeat(4,1fr)` → `repeat(auto-fit, minmax(72px, 1fr))`，並加 `@media (max-width:560px) { grid-template-columns: repeat(2,1fr) }`。
4. **`Dashboard.tsx:253` `grid-cols-3`** → `grid grid-cols-1 sm:grid-cols-3`。
5. **新增 e2e** `e2e/rwd-no-horizontal-scroll.spec.ts`：在 320/375/414/560/768 五個斷點走訪 `/`, `/holding-checkup-demo`, `/app`, `/company/dashboard`, `/company/conversion-center`，斷言 `document.documentElement.scrollWidth <= clientWidth + 1`。

### Phase 2 — P1 inline grid / 大字級統一規範
**目標：消滅散落的 inline `1fr 1fr 1fr` 與無 media query 大字體**

6. **新增共用 utility CSS**（`src/styles/rwd-grid.css`）：
   ```css
   .rwd-3col { display:grid; grid-template-columns: repeat(3, 1fr); gap:8px; }
   .rwd-4col { display:grid; grid-template-columns: repeat(4, 1fr); gap:8px; }
   @media (max-width: 560px) {
     .rwd-3col, .rwd-4col { grid-template-columns: repeat(2, 1fr); }
   }
   @media (max-width: 360px) {
     .rwd-3col, .rwd-4col { grid-template-columns: 1fr; }
   }
   .rwd-num-big { font-size: clamp(28px, 6vw, 46px); }
   .rwd-num-hero { font-size: clamp(40px, 10vw, 88px); }
   ```
7. **替換 inline grid**：`NewsTab.jsx:84`、`OverviewPanel.jsx:80`、`HoldingsPanel.tsx:315`、`HoldingsTable.jsx:228`、`EventsTab.jsx:388,477`。
8. **大字體換 clamp**：`HoldingsDetailPanel.tsx:326 (fontSize:46)`、`HoldingsHero.tsx:72 (fontSize:88)`、`DailyTab.jsx:319 (fontSize:28)`、`HoldingExportCard.tsx:103 (fontSize:64)`（後者僅 export 路徑、可保留但加 guard）。
9. **DECISION 卡 grid**：`HoldingsDetailPanel.tsx:349` `1fr auto` → `@media (max-width: 480px) { grid-template-columns: 1fr; }`，DECISION 卡折到下方。
10. **EventsTab 固定 px 欄**：`60px 56px 56px 1fr` → `minmax(48px,60px) minmax(44px,56px) minmax(44px,56px) 1fr`。

### Phase 3 — sticky 疊層、nowrap、Header 收斂
**目標：消除三層 sticky 互遮與 nowrap 溢出**

11. **FreeCheckup sticky 重整**：將 `top:0 / top:34` 改用 CSS variable `--sticky-h`，HoldingsFilterBar 第三層 sticky 改為 `top: var(--sticky-h, 68px)`，避免硬寫像素。
12. **nowrap CTA 改 overflow ellipsis 或 icon-only 模式 <480px**：`FreeCheckup.jsx:2894/2909/2922/2931/3002`、`ResearchPanel.jsx`、`HoldingsQuotaMeter.tsx`。
13. **Header `Wordmark`、`portfolio selector minWidth:190`**：在 `<480px` 改 icon-only + `min-width:0` 守護。
14. **ViewAsBanner**：剩餘時間倒數從 `hidden sm:inline` 升為 `inline`（資訊重要），其他次要欄維持隱藏。

### Phase 4 — e2e 防回歸補完
**目標：560 / 768 / 1023 三個目前 0 覆蓋的斷點全部加上 spec**

15. **新增** `e2e/rwd-no-horizontal-scroll.spec.ts`（已列於 Phase 1，斷點 320/375/414/560/768/1023）。
16. **新增** `e2e/rwd-key-pages.spec.ts`：每個斷點 × 關鍵頁面截圖 + 主 CTA 可見斷言：
    - 頁面：`/`、`/app`、`/app/expert/:slug`（demo）、`/holding-checkup-demo`、`/company/dashboard`、`/company/conversion-center`、`/checkout`（demo plan）
    - 斷言：主標題可見、主 CTA `inViewport`、`scrollWidth <= clientWidth + 1`
17. **`playwright.config.ts`** 新增 6 個 project：`rwd-320 / 375 / 414 / 560 / 768 / 1023`，testMatch `/rwd-.*\.spec\.ts/`。

---

## 三、技術備註

- **不動商業邏輯**，全部修改在 presentation 層（CSS / className / inline style）。
- **TableScroll 元件**放 `src/components/ui/TableScroll.tsx`，後台批次替換腳本可用 `rg -l '<table className="w-full' src/pages/company src/pages/_company* src/pages/_admin*` 鎖定範圍。
- **CSS clamp() / minmax()** 取代散落的 px / media query，是這次改善的核心模式；避免再用「inline fontSize + className + 另一處 <style>」這種拆三處的脆弱合約。
- **e2e 斷點命名一律 `rwd-XXX`**，避免和現有 `iphone-se-320` 等專案衝突。

---

## 四、預估規模與順序

| Phase | 檔案數 | 預估行數 | 風險 | 上線建議 |
|---|---|---|---|---|
| 1 | ~30（24 table + 6 元件） | ~120 | 低（純包 wrapper） | 立即 |
| 2 | ~10 | ~80 | 低（CSS class 替換） | Phase 1 隔日 |
| 3 | ~8 | ~60 | 中（sticky 重構） | Phase 2 後 1 日 |
| 4 | 2 spec + config | ~150 | 低（純測試） | 與每階段同步 |

**驗收標準**：所有 `rwd-*` e2e 在 6 斷點下全綠，且後台 `/company/*` 主要頁面在 768px 下無橫向 scroll。

請確認是否照此 4 階段執行；或要我先跑 Phase 1 + 4（最高 ROI），把 Phase 2/3 留到下次。