import { memo, lazy, Suspense, useState, useCallback, useMemo } from "react";
import { useBrainStore } from "@/checkup/stores/brainStore";
import { useViewportWidth } from "@/hooks/useViewportWidth";
import { useCheckupMode } from "@/checkup/contexts/CheckupModeContext";
import { useHoldingsDerivations } from "@/checkup/hooks/useHoldingsDerivations";
import { validateProps } from "@/checkup/components/freecheckup/_validateProps.js";
import HoldingsActionPriority from "@/checkup/components/freecheckup/HoldingsActionPriority";
import HoldingCard from "@/checkup/components/freecheckup/HoldingCard";
import HoldingsHero from "@/checkup/components/freecheckup/HoldingsHero";
import HoldingsQuotaMeter from "@/checkup/components/freecheckup/HoldingsQuotaMeter";
import HoldingsFilterBar from "@/checkup/components/freecheckup/HoldingsFilterBar";
import HoldingsReversalSection from "@/checkup/components/freecheckup/HoldingsReversalSection";
import HoldingsUploadSummary from "@/checkup/components/freecheckup/HoldingsUploadSummary";
import HoldingsEmptyState from "@/checkup/components/freecheckup/HoldingsEmptyState";
import HoldingsNoMatchState from "@/checkup/components/freecheckup/HoldingsNoMatchState";
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
  handleHoldingCardOpenDrawer: 'function',
  setSortBy: 'function',
  setSortDir: 'function',
  // 其它 prop（容許 any，避免 unknown-prop 警告噪音）
  DEMO_TAB_NOTICE_COPY: _opt('any'),
  wbTone: _opt('any'),
  quota: _opt('any'), tier: _opt('any'), tierLabel: _opt('any'), formatResetCountdown: _opt('any'),
  totalVal: _opt('any'), totalCost: _opt('any'), H: _opt('any'),
  winnersCount: _opt('any'), exitListCount: _opt('any'), reviewListCount: _opt('any'),
  MAX_HOLDINGS: _opt('any'), rtConnected: _opt('any'), lastUpdate: _opt('any'),
  uploadSummary: _opt('any'), setUploadSummary: _opt('any'),
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
};

const HoldingsDetailPanel = lazy(() => import("@/checkup/components/freecheckup/HoldingsDetailPanel"));

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
    // demo / auth notice
    DEMO_TAB_NOTICE_COPY,
    navigate,
    // theme tokens
    C, alpha, WB, wbTone,
    // quota / hero
    quota, tier, tierLabel, formatResetCountdown,
    totalVal, totalCost, H, winnersCount, exitListCount, reviewListCount,
    MAX_HOLDINGS, rtConnected, lastUpdate,
    // upload summary
    uploadSummary, setUploadSummary,
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
    // navigation
    setTab,
  } = props;

  // E-Maint-R7: isDemo / startLineLogin 優先由 CheckupModeContext 取得，
  // 缺少 provider 時（例如效能測試 fixture）退回 props，保持向後相容。
  let _mode = null;
  try { _mode = useCheckupMode(); } catch { _mode = null; }
  const isDemo = _mode ? _mode.isDemo : props.isDemo;
  const startLineLogin = _mode ? _mode.startLineLogin : props.startLineLogin;

  // E-Maint-R1: 6 個 derived useMemo 下沉
  const sorted = filteredSortedList; // 命名相容性
  const {
    displayed,
    variantsMap,
    orderedDisplayed,
    firstFeatureCode,
    actionPriorityItems,
    strategyOptions,
  } = useHoldingsDerivations({
    sorted,
    decisionsMap,
    stockMeta: STOCK_META,
    holdings: H,
    showAll,
    globalPriorityList,
  });

  // A2-lite: 純子元件 local UI state（避免污染 FreeCheckup parent）
  const [viewMode, setViewMode] = useState("grid"); // 'grid' | 'list'
  const [sortMenuOpen, setSortMenuOpen] = useState(false);

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

  // 卡片點選 toggle — 透過 store action，handler reference 永遠穩定
  const handleHoldingCardSelect = useCallback((code) => {
    toggleExpandedDecision(code);
  }, [toggleExpandedDecision]);

  return (
    <>
      {/* DEMO 持倉提示卡（與 events/news/daily/log 同款，僅訪客顯示） */}
      {isDemo && (
        <div style={{marginBottom:12,padding:"12px 14px",background:alpha(C.amber,'06'),border:`1px solid ${alpha(C.amber,'25')}`,borderRadius:8}}>
          <div style={{fontSize:12,fontWeight:500,color:C.text,marginBottom:4,letterSpacing:"0.02em"}}>{DEMO_TAB_NOTICE_COPY.holdings.title}</div>
          <div style={{fontSize:11,color:C.textMute,lineHeight:1.7,marginBottom:8}}>{DEMO_TAB_NOTICE_COPY.holdings.body}</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <button onClick={() => { try { startLineLogin?.(); } catch { navigate('/auth/login?redirect=/checkup'); } }} style={{background:"#06C755",color:"#fff",border:"none",borderRadius:6,padding:"5px 12px",fontSize:11,fontWeight:500,cursor:"pointer",letterSpacing:"0.02em"}}>LINE 登入解鎖</button>
            <button onClick={() => navigate('/auth/login?redirect=/checkup')} style={{background:"transparent",color:C.text,border:`1px solid ${C.border}`,borderRadius:6,padding:"5px 12px",fontSize:11,fontWeight:400,cursor:"pointer",letterSpacing:"0.02em"}}>Email 登入</button>
          </div>
        </div>
      )}
      {/* 配額卡：常駐顯示 used/limit 進度條 + 重置倒數 + 升級 CTA（訪客/載入中也顯示） */}
      <HoldingsQuotaMeter
        isDemo={isDemo}
        quota={quota}
        tier={tier}
        tierLabel={tierLabel}
        C={C}
        alpha={alpha}
        formatResetCountdown={formatResetCountdown}
      />
      {/* 上傳摘要：剛從上傳成交頁回來時顯示新增/更新項目（B1） */}
      <HoldingsUploadSummary
        uploadSummary={uploadSummary}
        setUploadSummary={setUploadSummary}
        C={C}
        alpha={alpha}
      />
      {/* ── Hero：橫向 2 欄構圖（左大數字 + 右市場狀態），底部 4 欄 KPI ── */}
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
        isDemo={isDemo}
        WB={WB}
        wbTone={wbTone}
      />


      {/* 反轉追蹤（虧損持股）— 預設折疊，避免擠壓卡片牆 */}
      <HoldingsReversalSection
        losers={losers}
        reversalConditions={reversalConditions}
        reviewingEvent={reviewingEvent}
        setReviewingEvent={setReviewingEvent}
        updateReversal={updateReversal}
        C={C}
        alpha={alpha}
      />

      {/* ══════════ Action Priority（單行 inline 文字流） ══════════
          B-P5: items 在 parent 已預先含 tag/desc，元件不再吃 decisionsMap/stockMeta */}
      <HoldingsActionPriority
        items={actionPriorityItems || globalPriorityList}
        WB={WB}
        onPick={setExpandedDecision}
      />


      {/* ── 持倉資料庫 Filter Bar ── */}
      <HoldingsFilterBar
        totalCount={H.length}
        filteredCount={filteredSortedList.length}
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
                if (active) setSortDir(d => d === "desc" ? "asc" : "desc");
                else { setSortBy(k); setSortDir("desc"); }
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

      {/* ══════════ 持倉決策工作台：左卡片牆 + 右 Detail Panel ══════════ */}
      {(() => {
        const selectedCode = expandedDecision;
        const selected = selectedCode ? displayed.find(x => x.code === selectedCode) || sorted.find(x => x.code === selectedCode) : null;

        const renderCard = (h) => (
          <HoldingCard
            key={h.code}
            holding={h}
            decision={decisionsMap[h.code]}
            target={targets?.[h.code]}
            avgTargetPrice={targets?.[h.code] ? avgTarget(h.code) : null}
            meta={STOCK_META[h.code] || null}
            sparkData={sparklines[h.code] || EMPTY_SPARK}
            sparkFailed={!!sparklineErrors[h.code]}
            variant={variantsMap.get(h.code) || 'plain'}
            isFeatureSlot={h.code === firstFeatureCode}
            isActive={selectedCode === h.code}
            onSelect={handleHoldingCardSelect}
            onOpenDrawer={handleHoldingCardOpenDrawer}
          />
        );


        const renderDetailPanel = () => (
          <Suspense fallback={null}>
            <HoldingsDetailPanel
              selected={selected}
              decisionsMap={decisionsMap}
              stockMeta={STOCK_META}
              targets={targets}
              avgTarget={avgTarget}
              normalizedEvents={normalizedEvents}
              orderedDisplayed={orderedDisplayed}
              WB={WB}
              setExpandedDecision={setExpandedDecision}
              openHoldingDrawer={openHoldingDrawer}
            />
          </Suspense>
        );

        // ── grid layout：selected 時才顯示 detail panel；否則卡片牆滿版 ──
        const showPanel = !!selected;
        return (
          <div style={{
            display:'grid',
            gridTemplateColumns: showPanel ? 'minmax(0, 1fr) minmax(0, 420px)' : 'minmax(0, 1fr)',
            gap: showPanel ? 20 : 0,
            alignItems:'flex-start',
          }} className="holdings-workbench">
            {/* 左：卡片牆 */}
            <div style={{
              display:'grid',
              gridTemplateColumns: cardGridCols,
              columnGap: 16,
              rowGap: 20,
            }} className={`holdings-card-grid${viewMode === 'list' ? ' holdings-card-grid--list' : ''}`}>
              {orderedDisplayed.map((h, idx) => renderCard(h, idx))}
              {/* 持倉為 0 時顯示強化空狀態（橫跨整列）；有持倉時顯示「+ 上傳成交」虛線卡 */}
              {orderedDisplayed.length === 0 && H.length === 0 ? (
                <HoldingsEmptyState
                  WB={WB}
                  onUpload={() => setTab && setTab('trade')}
                />
              ) : orderedDisplayed.length === 0 ? (
                /* P9: 有持倉但被篩選/搜尋過濾掉 — 「沒有符合條件的持倉」+ 清除全部篩選 CTA */
                <HoldingsNoMatchState
                  totalCount={H.length}
                  WB={WB}
                  onClearAll={() => {
                    setSearchQ('');
                    setFilterDecision(new Set());
                    setFilterThesis(new Set());
                    setFilterUrgency(new Set());
                    setFilterConflict(new Set());
                    setFilterPnl(new Set());
                    setFilterStrategy(new Set());
                  }}
                />
              ) : (
                <button
                  onClick={() => setTab && setTab('trade')}
                  className="wb-span-1"
                  style={{
                    minHeight: 320,
                    background:'transparent',
                    border:`1px dashed ${WB.hairStrong}`,
                    borderRadius:4,
                    color:WB.inkLight,
                    cursor:'pointer',
                    fontFamily:'inherit',
                    display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
                    gap:10,
                    letterSpacing:'0.18em',
                    transition:'border-color 160ms ease, color 160ms ease',
                  }}
                  onMouseEnter={(e)=>{e.currentTarget.style.borderColor=WB.ink;e.currentTarget.style.color=WB.ink;}}
                  onMouseLeave={(e)=>{e.currentTarget.style.borderColor=WB.hairStrong;e.currentTarget.style.color=WB.inkLight;}}
                >
                  <span style={{fontSize:24,fontWeight:300,lineHeight:1}}>+</span>
                  <span style={{fontSize:10,fontWeight:500}}>上傳成交</span>
                </button>
              )}
              {!showAll && sorted.length > 12 && (
                <button
                  onClick={() => setShowAll(true)}
                  className="wb-span-full"
                  style={{
                    padding:'12px',
                    background:'transparent',
                    border:`1px dashed ${WB.hair}`,
                    borderRadius:4,
                    color:WB.inkMute, fontSize:11, cursor:'pointer', fontWeight:500,
                    letterSpacing:'0.16em',
                    fontFamily:'inherit',
                  }}
                >
                  VIEW ALL {sorted.length}
                </button>
              )}
            </div>

            {/* 右：Detail Panel — 只在 selected 時顯示 */}
            {showPanel && (
              <aside
                className="holdings-detail-panel"
                style={{
                  position:'sticky', top:12,
                  background: WB.surface,
                  border:`1px solid ${WB.hairStrong}`,
                  borderRadius:4,
                  maxHeight:'calc(100vh - 24px)',
                  overflowY:'auto',
                }}
              >
                {renderDetailPanel()}
              </aside>
            )}
          </div>
        );
      })()}

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

      {/* D1：RWD 樣式已搬至 src/checkup/styles/holdingsTab.css，
          由 PostCSS 壓縮、且不再每次 render 產生新的 string text node。 */}
    </>
  );
}

export default memo(HoldingsTab);
