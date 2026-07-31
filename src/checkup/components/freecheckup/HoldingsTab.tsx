// @ts-nocheck — 漸進式 .jsx→.tsx 遷移（F-Maint-R4），完整型別化留待後續批次
import { memo, useState, useCallback, useMemo, useRef } from "react";
import { useBrainStore } from "@/checkup/stores/brainStore";
import { useViewportWidth } from "@/hooks/useViewportWidth";
import { useCheckupMode } from "@/checkup/contexts/CheckupModeContext";
import { useHoldingsDerivations } from "@/checkup/hooks/useHoldingsDerivations";
import { validateProps } from "@/checkup/lib/validateProps.js";
// @analytics-required: checkup_holdings_sort_change
import { track } from "@/lib/analytics/events";
import HoldingsActionPriority from "@/checkup/components/freecheckup/HoldingsActionPriority";
import HoldingsWorkbench from "@/checkup/components/freecheckup/HoldingsWorkbench";

import HoldingsHero from "@/checkup/components/freecheckup/HoldingsHero";
import HoldingsQuotaMeter from "@/checkup/components/freecheckup/HoldingsQuotaMeter";
import HoldingsFilterBar from "@/checkup/components/freecheckup/HoldingsFilterBar";
import HoldingsReversalSection from "@/checkup/components/freecheckup/HoldingsReversalSection";
import HoldingsSectorSummary from "@/checkup/components/freecheckup/HoldingsSectorSummary";
import HoldingMetaReportModal from "@/checkup/components/freecheckup/HoldingMetaReportModal";
import { useMetaOverrides } from "@/checkup/hooks/useMetaOverrides";
import { getMultiMeta } from "@/checkup/lib/stockMetaMulti.js";
import { matchSectorCodes } from "@/checkup/lib/holdingUtils";
import HoldingsUploadSummary from "@/checkup/components/freecheckup/HoldingsUploadSummary";
import BatchParsePanel from "@/checkup/components/freecheckup/BatchParsePanel";
import HoldingsFooterBar from "@/checkup/components/freecheckup/HoldingsFooterBar";
import "@/checkup/styles/holdingsTab.css";

// E1：HoldingsTab prop schema（dev-only，漏傳 setTab 等 callback 立即警告）
// E-Maint-R1 / R6 / R7 (holdings audit 2026-05 第二輪)：
//   - displayed / variantsMap / orderedDisplayed / firstFeatureCode / actionPriorityItems / strategyOptions
//     已下沉到 useHoldingsDerivations hook，parent 不再透傳
//   - WB / alpha / Sparkline 由 HoldingCard 直接 import constants.jsx，停止 prop 透傳
//   - isDemo / startLineLogin 由 useCheckupMode 直接讀取
const _opt = (type) => ({ type, optional: true });
const HOLDINGS_TAB_PROP_SCHEMA = {
  // 關鍵 callback / 結構（required）
  setTab: 'function',
  C: 'object',
  WB: 'object',                       // 仍用於本元件內 Detail Panel 外框
  alpha: 'function',                  // demo 提示卡片仍需 alpha(C.amber, ...)
  navigate: 'function',
  filteredSortedList: 'array',
  decisionsMap: 'object',
  STOCK_META: 'object',
  handleHoldingCardOpenDrawer: _opt('any'),
  setSortBy: 'function',
  setSortDir: 'function',
  // 其它 prop（容許 any，避免 unknown-prop 警告噪音）
  wbTone: _opt('any'),
  quota: _opt('any'), tier: _opt('any'), tierLabel: _opt('any'), formatResetCountdown: _opt('any'),
  totalVal: _opt('any'), totalCost: _opt('any'), H: _opt('any'),
  winnersCount: _opt('any'), exitListCount: _opt('any'), reviewListCount: _opt('any'),
  MAX_HOLDINGS: _opt('any'), rtConnected: _opt('any'), lastUpdate: _opt('any'),
  refreshing: _opt('any'), onRefreshPrices: _opt('any'), refreshError: _opt('any'),

  uploadSummary: _opt('any'), setUploadSummary: _opt('any'),
  batchParseSlot: _opt('any'),

  // R6：setTab 已於 L37 宣告為 required 'function'，此處不再重覆宣告以免 schema 覆蓋
  losers: _opt('any'), reversalConditions: _opt('any'),
  reviewingEvent: _opt('any'), setReviewingEvent: _opt('any'), updateReversal: _opt('any'),
  globalPriorityList: _opt('any'),
  searchQ: _opt('any'), setSearchQ: _opt('any'),
  filterDecision: _opt('any'), setFilterDecision: _opt('any'),
  filterThesis: _opt('any'), setFilterThesis: _opt('any'),
  filterUrgency: _opt('any'), setFilterUrgency: _opt('any'),
  filterConflict: _opt('any'), setFilterConflict: _opt('any'),
  filterPnl: _opt('any'), setFilterPnl: _opt('any'),
  filterStrategy: _opt('any'), setFilterStrategy: _opt('any'),
  toggleSetItem: _opt('any'), clearAllFilters: _opt('any'),
  sortBy: _opt('any'), sortDir: _opt('any'),
  targets: _opt('any'), avgTarget: _opt('any'),
  sparklines: _opt('any'), sparklineErrors: _opt('any'), EMPTY_SPARK: _opt('any'),
  normalizedEvents: _opt('any'), openHoldingDrawer: _opt('any'),
  showAll: _opt('any'), setShowAll: _opt('any'),
  holdingSyncStates: _opt('any'), // { [code]: { syncing?: bool, error?: string } }
  tradeLog: _opt('array'),        // A2: 抽屜資料源，傳給 HoldingsDetailPanel
};

// C8 (audit 2026-07)：HoldingsDetailPanel 的 lazy import 已下沉到 HoldingsWorkbench

/**
 * HoldingsTab — 從 FreeCheckup.jsx 抽出的「持倉」分頁完整內容（lazy-loaded）
 *
 * P3-perf：
 *   1. 整個 tab 以 React.lazy 載入，首屏不再為持倉牆付出解析/編譯成本
 *   2. memo 化避免 quote tick 引起無謂 re-render
 *   3. A2-lite：viewMode / sortMenuOpen / expandedDecision 為純子元件 local state，
 *      開選單/切視圖/選卡片不再污染 3300+ 行的 FreeCheckup parent
 *   4. E-Maint-R1：useHoldingsDerivations 收斂 6 個 derived useMemo
 */
function HoldingsTab(props) {
  // E1: dev-only schema check（漏傳 setTab 等核心 callback 立即在 console 警告）
  validateProps('HoldingsTab', props, HOLDINGS_TAB_PROP_SCHEMA);
  const {
    navigate,
    // theme tokens
    C, alpha, WB, wbTone,
    // quota / hero
    quota, tier, tierLabel, formatResetCountdown,
    totalVal, totalCost, H, winnersCount, exitListCount, reviewListCount,
    MAX_HOLDINGS, rtConnected, lastUpdate, refreshing, onRefreshPrices, refreshError,

    // upload summary
    uploadSummary, setUploadSummary,
    batchState, cancelBatch, retryBatchFailures, restoreBatchItemPreview,
    // reversal
    losers, reversalConditions, reviewingEvent, setReviewingEvent, updateReversal,
    // action priority + decisions
    globalPriorityList, decisionsMap, STOCK_META,
    // filter bar
    filteredSortedList,
    searchQ, setSearchQ,
    filterDecision, setFilterDecision,
    filterThesis, setFilterThesis,
    filterUrgency, setFilterUrgency,
    filterConflict, setFilterConflict,
    filterPnl, setFilterPnl,
    filterStrategy, setFilterStrategy,
    toggleSetItem, clearAllFilters,
    // sorting
    sortBy, setSortBy, sortDir, setSortDir,
    // workbench data
    targets, avgTarget, sparklines, sparklineErrors, EMPTY_SPARK,
    normalizedEvents, openHoldingDrawer,
    handleHoldingCardOpenDrawer,
    showAll, setShowAll,
    holdingSyncStates,
    // navigation
    setTab,
    // A2 抽屜資料源通線
    tradeLog,
  } = props;

  // E-Maint-R7 + C3 (audit 2026-06)：useCheckupMode 現在缺 provider 也回安全預設，
  // 不再 throw，可以直接在元件頂層無條件呼叫，符合 Rules of Hooks。
  // 若預設值的 isDemo/startLineLogin 與 props 並存（測試 fixture），優先用 props 覆寫。
  const _mode = useCheckupMode();
  const isDemo = props.isDemo !== undefined ? props.isDemo : _mode.isDemo;
  const startLineLogin = props.startLineLogin !== undefined ? props.startLineLogin : _mode.startLineLogin;

  // A2-lite: 純子元件 local UI state（避免污染 FreeCheckup parent）
  const [viewMode, setViewMode] = useState("grid"); // 'grid' | 'list'
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [reportingHolding, setReportingHolding] = useState(null);

  // 使用者 meta override（族群/題材/策略/營收比重）
  const { overrides, upsert: upsertOverride } = useMetaOverrides();
  const handleReportMeta = useCallback((h) => setReportingHolding(h), []);

  // 族群 chip 點擊後的就地篩選（產業／題材／策略，多選 + 聯集/交集）
  // R8：以 sessionStorage 持久化，避免切換 tab 後選擇消失
  const SECTOR_FILTER_KEY = 'checkup:holdings:sectorFilter:v1';
  const [sectorFilter, setSectorFilter] = useState(() => {
    try {
      if (typeof sessionStorage === 'undefined') return { items: [], mode: 'union' };
      const raw = sessionStorage.getItem(SECTOR_FILTER_KEY);
      if (!raw) return { items: [], mode: 'union' };
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.items)) return { items: [], mode: 'union' };
      return {
        items: parsed.items.filter((it) => it && typeof it.kind === 'string' && typeof it.key === 'string'),
        mode: parsed.mode === 'intersection' ? 'intersection' : 'union',
      };
    } catch { return { items: [], mode: 'union' }; }
  });
  const setSectorFilterPersisted = useCallback((next) => {
    setSectorFilter(next);
    try { sessionStorage.setItem(SECTOR_FILTER_KEY, JSON.stringify(next)); } catch {}
  }, []);
  const sectorMatchedCodes = useMemo(() => {
    const set = matchSectorCodes(H, STOCK_META, overrides, sectorFilter.items, sectorFilter.mode);
    if (!set) return null;
    const s = new Set();
    for (const c of set) s.add(String(c));
    return s;
  }, [sectorFilter, H, STOCK_META, overrides]);

  // E-Maint-R1: 6 個 derived useMemo 下沉
  const rawSorted = filteredSortedList; // 命名相容性
  const sorted = useMemo(
    () => (sectorMatchedCodes
      ? (rawSorted || []).filter((x) => sectorMatchedCodes.has(String(x.code)))
      : rawSorted),
    [rawSorted, sectorMatchedCodes],
  );
  const {
    displayed,
    variantsMap,
    orderedDisplayed,
    firstFeatureCode,
    actionPriorityItems,
    remainingItems,
    uniqueHoldings,
    topActionableCount,
    strategyOptions,
  } = useHoldingsDerivations({
    sorted,
    decisionsMap,
    stockMeta: STOCK_META,
    holdings: H,
    showAll,
    globalPriorityList,
  });

  // D-Perf-R2 (2026-05 第二輪)：viewport 訂閱下沉到本元件
  const vw = useViewportWidth(1280);
  const cardGridCols = useMemo(
    () => (vw <= 640
      ? '1fr'
      : vw <= 1279
        ? 'repeat(2, minmax(0, 1fr))'
        : 'repeat(3, minmax(0, 1fr))'),
    [vw]
  );

  // E2: expandedDecision 改由 brainStore 管理（與 expandedStock 同步治理）
  const expandedDecision = useBrainStore((s) => s.expandedDecision);
  const setExpandedDecision = useBrainStore((s) => s.setExpandedDecision);
  const toggleExpandedDecision = useBrainStore((s) => s.toggleExpandedDecision);

  // 卡片點選 toggle — 不再依 viewport 分流到 legacy overlay drawer，
  // 全螢幕尺寸都展開新版 HoldingsDetailPanel（含 ComparisonCharts / ExportMenu）。
  // 窄螢幕由 CSS 把 panel 改為全寬顯示在卡片牆下方。
  const vwRef = useRef(vw);
  vwRef.current = vw;
  const handleHoldingCardSelect = useCallback((code) => {
    toggleExpandedDecision(code);
  }, [toggleExpandedDecision]);

  return (
    <>
      {/* §6.5：Demo 提示卡已移除，改由頁腳 DemoFooterHint 統一提示 */}
      {/* 配額卡：常駐顯示 used/limit 進度條 + 重置倒數 + 升級 CTA（訪客/載入中也顯示） */}
      <HoldingsQuotaMeter
        isDemo={isDemo}
        quota={quota}
        tier={tier}
        tierLabel={tierLabel}
        C={C}
        alpha={alpha}
        formatResetCountdown={formatResetCountdown}
        isLineBound={!!_mode.lineProfile?.lineUserId}
      />
      {/* 批次解析狀態：ADR-0005 §5 槽位注入，由 shell 決定放哪個模組的元件（M4 BatchParsePanel） */}
      {batchParseSlot}

      {/* 上傳摘要：剛從上傳成交頁回來時顯示新增/更新項目（B1） */}
      <HoldingsUploadSummary
        uploadSummary={uploadSummary}
        setUploadSummary={setUploadSummary}
        C={C}
        alpha={alpha}
      />
      <HoldingsHero
        totalVal={totalVal}
        totalCost={totalCost}
        holdingsCount={H.length}
        winnersCount={winnersCount}
        exitListLength={exitListCount || 0}
        reviewListLength={reviewListCount || 0}
        maxHoldings={MAX_HOLDINGS}
        rtConnected={rtConnected}
        lastUpdate={lastUpdate}
        refreshing={refreshing}
        onRefreshPrices={onRefreshPrices}
        refreshError={refreshError || undefined}
        isDemo={isDemo}
        WB={WB}
        wbTone={wbTone}
        holdings={H}
      />




      {/* 族群分佈總覽（產業＋題材）— 讓使用者一眼看出集中/分散；點 chip 直接篩選下方卡片 */}
      <HoldingsSectorSummary
        holdings={H}
        stockMeta={STOCK_META}
        overrides={overrides}
        C={C}
        alpha={alpha}
        selected={sectorFilter}
        onSelect={setSectorFilterPersisted}
      />


      {/* HoldingsReversalSection 已下線（不在設計規格 §3 內），losers 由「今日待辦」統一呈現 */}

      {/* ══════════ Action Priority（單行 inline 文字流） ══════════
          B-P5: items 在 parent 已預先含 tag/desc，元件不再吃 decisionsMap/stockMeta */}
      <HoldingsActionPriority
        items={actionPriorityItems}
        holdCount={remainingItems.length}
        WB={WB}
        onPick={setExpandedDecision}
      />



      {/* ── 持倉資料庫 Filter Bar ── */}
      <HoldingsFilterBar
        totalCount={H.length}
        filteredCount={sorted.length}
        searchQ={searchQ}
        setSearchQ={setSearchQ}
        filterDecision={filterDecision}
        setFilterDecision={setFilterDecision}
        filterThesis={filterThesis}
        setFilterThesis={setFilterThesis}
        filterUrgency={filterUrgency}
        setFilterUrgency={setFilterUrgency}
        filterConflict={filterConflict}
        setFilterConflict={setFilterConflict}
        filterPnl={filterPnl}
        setFilterPnl={setFilterPnl}
        filterStrategy={filterStrategy}
        setFilterStrategy={setFilterStrategy}
        strategyOptions={strategyOptions}
        toggleSetItem={toggleSetItem}
        clearAllFilters={clearAllFilters}
        C={C}
        alpha={alpha}
      />

      {/* 排序（D2：role="group" + aria-pressed 提供鍵盤/螢幕閱讀器導覽） */}
      <div role="group" aria-label="排序方式" style={{display:"flex",gap:4,marginBottom:10,alignItems:"center",flexWrap:"wrap"}}>
        <span style={{fontSize:10,color:C.textMute,letterSpacing:"0.08em",fontWeight:400}}>排序</span>
        {[["value","市值"],["pnl","損益"],["pct","報酬%"],["urgency","緊急"],["confidence","信心"],["updated","更新"],["decision","決策"]].map(([k,l])=>{
          const active = sortBy === k;
          const dirLabel = active ? (sortDir === "desc" ? "由大到小" : "由小到大") : "未啟用";
          return (
            <button
              key={k}
              type="button"
              aria-pressed={active}
              aria-label={`依${l}排序，目前${dirLabel}`}
              onClick={()=>{
                let nextDir;
                if (active) { nextDir = sortDir === "desc" ? "asc" : "desc"; setSortDir(nextDir); }
                else { nextDir = "desc"; setSortBy(k); setSortDir("desc"); }
                // H3: analytics
                try { track('checkup_holdings_sort_change', { sort_by: k, sort_dir: nextDir }); } catch {}
              }}
              style={{
                background:"transparent",
                color: active ? C.textSec : C.textMute,
                border:"none",
                borderBottom: active ? `1px solid ${C.textMute}` : "1px solid transparent",
                borderRadius:0, padding:"3px 8px", fontSize:11, fontWeight:400, cursor:"pointer",
                transition:"all 0.15s",
                display:"inline-flex", alignItems:"center", gap:2,
              }}
            >
              {l}
              {active && <span style={{fontSize:9,opacity:0.7}}>{sortDir === "desc" ? "↓" : "↑"}</span>}
            </button>
          );
        })}
      </div>

      {/* ══════════ 持倉決策工作台：左卡片牆 + 右 Detail Panel ══════════
        C8 (audit 2026-07)：原 IIFE 已抽為 HoldingsWorkbench，且 CTA hover 樣式
        搬遷至 src/checkup/styles/holdingsTab.css .holdings-upload-cta / .holdings-view-all-cta
        2026-07-21：外層加 .holdings-refresh-shell — refreshing 時淡化 + progress bar，
        避免使用者在同步中重複點擊觸發操作。 */}
      <div
        className="holdings-refresh-shell"
        data-refreshing={refreshing ? 'true' : 'false'}
        data-testid="holdings-refresh-shell"
        aria-busy={!!refreshing}
      >
        {refreshing && (
          <>
            <div className="holdings-refresh-progress" aria-hidden="true" />
            <div className="holdings-refresh-badge" data-testid="holdings-refresh-badge">
              同步中
            </div>
          </>
        )}
        <div className="holdings-refresh-content">
          {refreshing && (!H || H.length === 0) ? (
            <div
              className="holdings-skeleton-grid"
              data-testid="holdings-skeleton-grid"
              role="status"
              aria-label="正在載入持倉資料"
            >
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="holdings-skeleton-card" aria-hidden="true">
                  <div className="holdings-skeleton-line sk-w-40 sk-h-16" />
                  <div className="holdings-skeleton-line sk-w-80" />
                  <div className="holdings-skeleton-line sk-w-60" />
                  <div className="holdings-skeleton-line sk-w-80" />
                </div>
              ))}
            </div>
          ) : (
            <HoldingsWorkbench
              WB={WB}
              expandedDecision={expandedDecision}
              setExpandedDecision={setExpandedDecision}
              displayed={displayed}
              sorted={sorted}
              orderedDisplayed={orderedDisplayed}
              variantsMap={variantsMap}
              firstFeatureCode={firstFeatureCode}
              decisionsMap={decisionsMap}
              targets={targets}
              avgTarget={avgTarget}
              STOCK_META={STOCK_META}
              overrides={overrides}
              sparklines={sparklines}
              sparklineErrors={sparklineErrors}
              EMPTY_SPARK={EMPTY_SPARK}
              holdingSyncStates={holdingSyncStates}
              handleHoldingCardSelect={handleHoldingCardSelect}
              handleHoldingCardOpenDrawer={handleHoldingCardOpenDrawer}
              handleReportMeta={handleReportMeta}
              normalizedEvents={normalizedEvents}
              openHoldingDrawer={openHoldingDrawer}
              totalVal={totalVal}
              sortBy={sortBy}
              sortDir={sortDir}
              setSortBy={setSortBy}
              setSortDir={setSortDir}
              cardGridCols={cardGridCols}
              viewMode={viewMode}
              H={H}
              setTab={setTab}
              setSearchQ={setSearchQ}
              setFilterDecision={setFilterDecision}
              setFilterThesis={setFilterThesis}
              setFilterUrgency={setFilterUrgency}
              setFilterConflict={setFilterConflict}
              setFilterPnl={setFilterPnl}
              setFilterStrategy={setFilterStrategy}
              setSectorFilterPersisted={setSectorFilterPersisted}
              showAll={showAll}
              setShowAll={setShowAll}
              tradeLog={tradeLog}
            />
          )}
        </div>
      </div>



      {/* Step 7：底部狀態列（B4） */}
      <HoldingsFooterBar
        sortedCount={sorted.length}
        sortBy={sortBy}
        setSortBy={setSortBy}
        sortDir={sortDir}
        setSortDir={setSortDir}
        sortMenuOpen={sortMenuOpen}
        setSortMenuOpen={setSortMenuOpen}
        viewMode={viewMode}
        setViewMode={setViewMode}
        WB={WB}
      />

      {/* 分類回報 modal */}
      {reportingHolding && (
        <ReportingModalHost
          reportingHolding={reportingHolding}
          STOCK_META={STOCK_META}
          overrides={overrides}
          upsertOverride={upsertOverride}
          onClose={() => setReportingHolding(null)}
        />
      )}

      {/* D1：RWD 樣式已搬至 src/checkup/styles/holdingsTab.css，
          由 PostCSS 壓縮、且不再每次 render 產生新的 string text node。 */}
    </>
  );
}

export default memo(HoldingsTab);

// C13 (audit 2026-07)：把 modal wrapper 抽成子元件，
// 讓 currentMeta 用 useMemo 穩定 reference。
// 否則 getMultiMeta(...) 每次 HoldingsTab render 都回傳新 object，
// 觸發 modal 內 useEffect([holding, currentMeta]) 反覆 fire，
// 把使用者剛輸入的欄位覆蓋回 base 值（e2e persist test 抓到此回歸）。
function ReportingModalHost({ reportingHolding, STOCK_META, overrides, upsertOverride, onClose }) {
  const overrideRow = overrides?.[reportingHolding.code];
  const currentMeta = useMemo(
    () => getMultiMeta(reportingHolding.code, STOCK_META, overrideRow),
    [reportingHolding.code, STOCK_META, overrideRow],
  );
  return (
    <HoldingMetaReportModal
      holding={reportingHolding}
      currentMeta={currentMeta}
      onClose={onClose}
      upsert={upsertOverride}
    />
  );
}
