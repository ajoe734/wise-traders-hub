// @ts-nocheck
// C8 (audit 2026-07)：從 HoldingsTab.tsx L375-540 的 IIFE 抽出。
// 2026-07 update：右側 Detail Panel 改用可存取的 Sheet（Radix Dialog）
// —— 遮罩點擊關閉、Esc 關閉、焦點陷阱、aria-modal 皆由 Radix 提供。
import { Suspense, lazy, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import HoldingCard from '@/checkup/components/freecheckup/HoldingCard';
import HoldingsEmptyState from '@/checkup/components/freecheckup/HoldingsEmptyState';
import HoldingsNoMatchState from '@/checkup/components/freecheckup/HoldingsNoMatchState';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
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

  const sheetRef = useRef<HTMLDivElement | null>(null);
  const onScrollRef = useRef<(() => void) | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [showTopBtn, setShowTopBtn] = useState(false);

  // 抽屜內部滾動時顯示「回到頂部」按鈕；透過 callback ref 掛載，避免 Sheet 動畫/portal 導致時序問題
  const setSheetRef = useCallback((node: HTMLDivElement | null) => {
    if (onScrollRef.current && sheetRef.current) {
      sheetRef.current.removeEventListener('scroll', onScrollRef.current);
    }
    sheetRef.current = node;
    if (node) {
      // 抽屜開啟時，先把內部捲軸歸零（不動畫，避免與 Sheet 進場動畫互撞）
      node.scrollTop = 0;
      setShowTopBtn(false);
      const onScroll = () => setShowTopBtn(node.scrollTop > 160);
      onScrollRef.current = onScroll;
      node.addEventListener('scroll', onScroll, { passive: true });
    } else {
      onScrollRef.current = null;
      setShowTopBtn(false);
    }
  }, []);

  const registerCardRef = useCallback((code: string) => (node: HTMLDivElement | null) => {
    if (node) cardRefs.current.set(code, node);
    else cardRefs.current.delete(code);
  }, []);

  // 抽屜開啟時，把對應的持倉卡平滑捲入視野。
  // 使用雙 rAF 等待 Sheet 進場動畫佈局穩定，避免 layout thrash 造成 jank；
  // 用 block: 'nearest' 讓已在畫面內的卡片不做多餘位移。
  useEffect(() => {
    if (!expandedDecision) return;
    let raf1 = 0;
    let raf2 = 0;
    const t = window.setTimeout(() => {
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => {
          const el = cardRefs.current.get(expandedDecision);
          if (!el) return;
          const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
          el.scrollIntoView({
            behavior: prefersReduced ? 'auto' : 'smooth',
            block: 'nearest',
            inline: 'nearest',
          });
        });
      });
    }, 60);
    return () => {
      window.clearTimeout(t);
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [expandedDecision]);




  const cardWallStyle = useMemo(
    () => ({
      display: 'grid',
      gridTemplateColumns: cardGridCols,
      columnGap: 16,
      rowGap: 20,
    }),
    [cardGridCols],
  );


  const handleOpenChange = (open: boolean) => {
    if (!open) setExpandedDecision?.(null);
  };

  return (
    <div className="holdings-workbench">

      <div
        style={cardWallStyle}
        className={`holdings-card-grid${viewMode === 'list' ? ' holdings-card-grid--list' : ''}`}
      >
        {orderedDisplayed.map((h) => (
          <div
            key={h.code}
            ref={registerCardRef(h.code)}
            style={{ scrollMarginTop: 96, scrollMarginBottom: 32 }}
          >
            <HoldingCard
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
          </div>
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

      {/* Detail Panel — Sheet（Radix Dialog）：遮罩點擊關閉、Esc 關閉、焦點陷阱、aria-modal */}
      <Sheet open={showPanel} onOpenChange={handleOpenChange}>
        <SheetContent
          ref={setSheetRef}
          side="right"
          data-testid="holdings-detail-panel"
          className="w-full sm:max-w-md md:max-w-lg lg:max-w-xl xl:max-w-2xl overflow-y-auto p-0"
          style={{
            background: WB.surface,
            borderColor: WB.hairStrong,
            overscrollBehavior: 'contain',
          }}
        >
          <VisuallyHidden asChild>
            <SheetHeader>
              <SheetTitle>
                {selected ? `持倉細節 ${selected.code}` : '持倉細節'}
              </SheetTitle>
              <SheetDescription>
                成本／區間／佔比 + PNG·PDF 匯出。按 Esc 或點擊遮罩可關閉。
              </SheetDescription>
            </SheetHeader>
          </VisuallyHidden>
          {selected && (
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
                sparkData30D={sparklines?.[selected.code] || []}
                sortBy={sortBy}
                sortDir={sortDir}
                setSortBy={setSortBy}
                setSortDir={setSortDir}
              />
            </Suspense>
          )}
          {showTopBtn && (
            <button
              type="button"
              aria-label="回到頂部"
              onClick={() =>
                sheetRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
              }
              className="absolute bottom-4 right-4 z-50 flex h-11 w-11 items-center justify-center rounded-full border focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-opacity"
              style={{
                background: WB.surface,
                borderColor: WB.hairStrong,
                color: WB.ink,
              }}
            >
              <ArrowUp className="h-5 w-5" />
              <span className="sr-only">回到頂部</span>
            </button>
          )}
        </SheetContent>
      </Sheet>

    </div>
  );
}

export default memo(HoldingsWorkbench);
