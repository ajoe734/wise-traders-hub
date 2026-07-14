// @ts-nocheck
// C8 (audit 2026-07)：從 HoldingsTab.tsx L375-540 的 IIFE 抽出。
// 目標：讓左卡片牆 + 右 Detail Panel 的版型有穩定 component identity，
// 避免每次 HoldingsTab render 都重建整段 JSX；同時把 `selected` 與 grid 樣式
// 交給 useMemo。原本的 `+ 上傳成交` 虛線卡 hover 也從 inline onMouseEnter/Leave
// 搬到 .holdings-upload-cta CSS class（見 src/checkup/styles/holdingsTab.css）。
import { Suspense, lazy, memo, useEffect, useMemo, useRef } from 'react';
import HoldingCard from '@/checkup/components/freecheckup/HoldingCard';
import HoldingsEmptyState from '@/checkup/components/freecheckup/HoldingsEmptyState';
import HoldingsNoMatchState from '@/checkup/components/freecheckup/HoldingsNoMatchState';
// C12 (audit 2026-07)：改用 getMultiMeta 走 5 層權威（DB override → overlay JSON →
// STOCK_META → TWSE → FinMind → UNCLASSIFIED），與族群聚合面板同源，
// 避免 HoldingCard 上顯示「未分類」而聚合卡卻有產業的不一致。
import { getMultiMeta } from '@/checkup/lib/stockMetaMulti.js';

const HoldingsDetailPanel = lazy(
  () => import('@/checkup/components/freecheckup/HoldingsDetailPanel'),
);

function HoldingsWorkbench(props) {
  const {
    WB,
    expandedDecision,
    displayed,
    sorted,
    orderedDisplayed,
    variantsMap,
    firstFeatureCode,
    decisionsMap,
    targets,
    avgTarget,
    STOCK_META,
    overrides,
    sparklines,
    sparklineErrors,
    EMPTY_SPARK,
    holdingSyncStates,
    handleHoldingCardSelect,
    handleHoldingCardOpenDrawer,
    handleReportMeta,
    normalizedEvents,
    openHoldingDrawer,
    totalVal,
    sortBy,
    sortDir,
    setSortBy,
    setSortDir,
    setExpandedDecision,
    cardGridCols,
    viewMode,
    H,
    setTab,
    setSearchQ,
    setFilterDecision,
    setFilterThesis,
    setFilterUrgency,
    setFilterConflict,
    setFilterPnl,
    setFilterStrategy,
    setSectorFilterPersisted,
    showAll,
    setShowAll,
  } = props;

  const selected = useMemo(() => {
    if (!expandedDecision) return null;
    return (
      (displayed && displayed.find((x) => x.code === expandedDecision)) ||
      (sorted && sorted.find((x) => x.code === expandedDecision)) ||
      null
    );
  }, [expandedDecision, displayed, sorted]);

  const showPanel = !!selected;

  const gridStyle = useMemo(
    () => ({
      display: 'grid',
      gridTemplateColumns: showPanel
        ? 'minmax(0, 1fr) minmax(0, 420px)'
        : 'minmax(0, 1fr)',
      gap: showPanel ? 20 : 0,
      alignItems: 'flex-start',
    }),
    [showPanel],
  );

  const cardWallStyle = useMemo(
    () => ({
      display: 'grid',
      gridTemplateColumns: cardGridCols,
      columnGap: 16,
      rowGap: 20,
    }),
    [cardGridCols],
  );

  const panelRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!showPanel || !panelRef.current) return;
    // 開啟時捲動到 panel（尤其手機／窄螢幕 panel 在下方使用者看不到）
    const id = window.setTimeout(() => {
      panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
    return () => window.clearTimeout(id);
  }, [showPanel, expandedDecision]);

  return (
    <div style={gridStyle} className="holdings-workbench">
      {/* 左：卡片牆 */}
      <div
        style={cardWallStyle}
        className={`holdings-card-grid${viewMode === 'list' ? ' holdings-card-grid--list' : ''}`}
      >
        {orderedDisplayed.map((h) => (
          <HoldingCard
            key={h.code}
            holding={h}
            decision={decisionsMap[h.code]}
            target={targets?.[h.code]}
            avgTargetPrice={targets?.[h.code] ? avgTarget(h.code) : null}
            meta={getMultiMeta(h.code, STOCK_META, overrides?.[h.code])}
            sparkData={sparklines[h.code] || EMPTY_SPARK}
            sparkFailed={!!sparklineErrors[h.code]}
            variant={variantsMap.get(h.code) || 'plain'}
            isFeatureSlot={h.code === firstFeatureCode}
            isActive={expandedDecision === h.code}
            syncState={holdingSyncStates?.[h.code]}
            onSelect={handleHoldingCardSelect}
            onOpenDrawer={handleHoldingCardOpenDrawer}
            onReportMeta={handleReportMeta}
          />
        ))}

        {orderedDisplayed.length === 0 && H.length === 0 ? (
          <HoldingsEmptyState WB={WB} onUpload={() => setTab && setTab('trade')} />
        ) : orderedDisplayed.length === 0 ? (
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
              setSectorFilterPersisted({ items: [], mode: 'union' });
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setTab && setTab('trade')}
            className="wb-span-1 holdings-upload-cta"
            style={{
              '--wb-hair-strong': WB.hairStrong,
              '--wb-ink': WB.ink,
              '--wb-ink-light': WB.inkLight,
            } as React.CSSProperties}
          >
            <span className="holdings-upload-cta__plus">+</span>
            <span className="holdings-upload-cta__label">上傳成交</span>
          </button>
        )}

        {!showAll && sorted.length > 12 && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="wb-span-full holdings-view-all-cta"
            style={{
              '--wb-hair': WB.hair,
              '--wb-ink-mute': WB.inkMute,
            } as React.CSSProperties}
          >
            VIEW ALL {sorted.length}
          </button>
        )}
      </div>

      {/* 右：Detail Panel — 只在 selected 時顯示 */}
      {showPanel && (
        <aside
          ref={panelRef}
          className="holdings-detail-panel"
          data-testid="holdings-detail-panel"
          style={{
            position: 'sticky',
            top: 12,
            background: WB.surface,
            border: `1px solid ${WB.hairStrong}`,
            borderRadius: 4,
            maxHeight: 'calc(100vh - 24px)',
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            paddingBottom: 32,
            scrollMarginTop: 12,
          }}
        >
          <div
            className="holdings-detail-panel__narrow-hint"
            data-testid="holdings-panel-narrow-hint"
            style={{
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              borderBottom: `1px solid ${WB.hair}`,
              background: WB.surfaceSoft,
              color: WB.inkMute,
              fontSize: 11,
              letterSpacing: '0.12em',
              fontWeight: 500,
            }}
          >
            <span aria-hidden style={{ fontSize: 12, color: WB.ink }}>
              ✓
            </span>
            <span>已展開完整圖表面板（成本／區間／佔比 + PNG·PDF 匯出）</span>
          </div>
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
              totalPortfolioValue={totalVal || 0}
              sparkData30D={selected ? sparklines?.[selected.code] || [] : []}
              sortBy={sortBy}
              sortDir={sortDir}
              setSortBy={setSortBy}
              setSortDir={setSortDir}
            />
          </Suspense>
        </aside>
      )}
    </div>
  );
}

export default memo(HoldingsWorkbench);
