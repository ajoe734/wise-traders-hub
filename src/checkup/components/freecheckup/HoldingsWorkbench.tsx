// @ts-nocheck
// C8 (audit 2026-07)：從 HoldingsTab.tsx L375-540 的 IIFE 抽出。
// 2026-07 update：右側 Detail Panel 改用可存取的 Sheet（Radix Dialog）
// —— 遮罩點擊關閉、Esc 關閉、焦點陷阱、aria-modal 皆由 Radix 提供。
import { Suspense, lazy, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { getSparkCloses } from '@/checkup/lib/holdingDetailViewModel';
import { useSparklines } from '@/checkup/hooks/useSparklines';
import { useChipsBatch } from '@/checkup/hooks/useChipsBatch';
import { useCheckupMode } from '@/checkup/contexts/CheckupModeContext';
import { EMPTY_SPARK } from '@/pages/_freeCheckup/constants.jsx';
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
    tradeLog,
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

  const { isDemo } = useCheckupMode();

  // 候選 D/F：走勢與籌碼資料在 workbench 層統一取得，不再由 FreeCheckup 父層 prop 透傳。
  const sparklineCodes = useMemo(
    () => orderedDisplayed.map((h) => String(h.code).trim()).filter(Boolean),
    [orderedDisplayed],
  );
  // 走勢／量能是公開市場資料，不含使用者持倉資訊：Demo 模式同樣走真實
  // checkup-sparkline（OHLCV）。否則抽屜只剩合成 K 棒，量柱永遠是空狀態。
  const { sparklines, sparklineErrors } = useSparklines(sparklineCodes, { enabled: true });
  const { prefetch } = useChipsBatch({ codes: sparklineCodes, enabled: !isDemo });

  const sheetRef = useRef<HTMLDivElement | null>(null);
  const onScrollRef = useRef<(() => void) | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [showTopBtn, setShowTopBtn] = useState(false);
  // 記錄開啟前的 focus 元素，Sheet 關閉時還原（Radix `onCloseAutoFocus` 契約）。
  // 卡片透過程式 setExpandedDecision 開抽屜（不是 SheetTrigger），
  // Radix 無從得知 trigger，需要手動 restore。
  const previousFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (showPanel) {
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body) previousFocusRef.current = active;
    }
  }, [showPanel]);

  // 抽屜內部滾動時顯示「回到頂部」按鈕。
  //
  // 根因修法：Radix `SheetContent` 內部用 `composeRefs` 合併多個 ref，
  // 每次 re-render 都會產生新的 ref 函式；React 對於函式型 ref 的規則是
  // 只要函式 identity 變了，就會依序呼叫舊(null) → 新(node) 來重新掛載。
  // 過去的實作在 ref callback 裡直接 `node.scrollTop = 0`，加上
  // scroll 事件會 setState 觸發父層 re-render，形成「滾動 → setState →
  // 父層 re-render → composeRefs 新函式 → React re-attach ref →
  // scrollTop 被重設為 0」的無限重設迴圈，導致抽屜怎麼都滑不下去。
  //
  // 修正策略：
  //   1) ref callback 只負責同步 sheetRef.current，不做任何副作用
  //   2) scroll listener 用 useEffect 掛載，依賴 `showPanel`；只有抽屜
  //      真正開啟時才 attach、關閉時才 detach，不再受 re-render 影響
  //   3) 「抽屜開啟時把 scrollTop 歸零」也搬到同一支 useEffect，並且
  //      只在 open 邊緣觸發一次
  const setSheetRef = useCallback((node: HTMLDivElement | null) => {
    sheetRef.current = node;
  }, []);

  useEffect(() => {
    if (!showPanel) {
      setShowTopBtn(false);
      return;
    }
    // 等 Radix Portal + 進場動畫佈局穩定後再取 node，避免拿到還沒掛載的 ref
    let raf = 0;
    let cleanup: (() => void) | null = null;
    const attach = () => {
      const node = sheetRef.current;
      if (!node) {
        raf = requestAnimationFrame(attach);
        return;
      }
      // 只在抽屜「開啟的當下」歸零一次；之後 re-render 不再重設
      node.scrollTop = 0;
      setShowTopBtn(false);
      let ticking = false;
      const onScroll = () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          ticking = false;
          const cur = sheetRef.current;
          if (!cur) return;
          setShowTopBtn(cur.scrollTop > 160);
        });
      };
      onScrollRef.current = onScroll;
      node.addEventListener('scroll', onScroll, { passive: true });
      cleanup = () => {
        node.removeEventListener('scroll', onScroll);
        onScrollRef.current = null;
      };
    };
    raf = requestAnimationFrame(attach);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (cleanup) cleanup();
    };
  }, [showPanel]);

  // 抽屜開啟時，把對應的持倉卡平滑捲入視野。
  // - 用雙 rAF 等 Sheet 進場動畫佈局穩定，避免 layout thrash 造成 jank
  // - block: 'nearest' 讓已在畫面內的卡片不做多餘位移
  // - 尊重 prefers-reduced-motion
  useEffect(() => {
    if (!expandedDecision) return;
    let raf1 = 0;
    let raf2 = 0;
    const t = window.setTimeout(() => {
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => {
          const root = gridRef.current;
          if (!root) return;
          const safeCode = String(expandedDecision).replace(/"/g, '\\"');
          const el = root.querySelector<HTMLElement>(
            `[data-holding-code="${safeCode}"]`,
          );
          if (!el) return;
          const rect = el.getBoundingClientRect();
          const vh = window.innerHeight || document.documentElement.clientHeight;
          // 已完整在畫面內就不動，避免無意義位移
          if (rect.top >= 72 && rect.bottom <= vh - 24) return;
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

  const openNewDetailPanel = useCallback(
    (code: string) => setExpandedDecision?.(code),
    [setExpandedDecision],
  );
  const openResearchNote = useCallback(
    (code: string) => {
      if (typeof openHoldingDrawer === 'function') openHoldingDrawer(code);
      else setExpandedDecision?.(code);
    },
    [openHoldingDrawer, setExpandedDecision],
  );

  return (
    <div className="holdings-workbench">

      <div
        ref={gridRef}
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
            sparkData={getSparkCloses(sparklines[h.code]) || EMPTY_SPARK}
            sparkFailed={!!sparklineErrors[h.code]}
            variant={variantsMap.get(h.code) || 'plain'}
            isFeatureSlot={h.code === firstFeatureCode}
            isActive={expandedDecision === h.code}
            syncState={holdingSyncStates?.[h.code]}
            onSelect={handleHoldingCardSelect}
            onOpenDrawer={handleHoldingCardOpenDrawer || openNewDetailPanel}
            onReportMeta={handleReportMeta}
            onPrefetch={prefetch}
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
        ) : null /* §6.3：上傳降為 modal（頂欄「＋ 上傳」按鈕），移除卡牆內冗餘 tile */}

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
            顯示全部 {sorted.length} 檔
          </button>
        )}
      </div>

      {/* Detail Panel — Sheet（Radix Dialog）：遮罩點擊關閉、Esc 關閉、焦點陷阱、aria-modal */}
      <Sheet open={showPanel} onOpenChange={handleOpenChange}>
        <SheetContent
          ref={setSheetRef}
          side="right"
          data-testid="holdings-detail-panel"
          onCloseAutoFocus={(e) => {
            const prev = previousFocusRef.current;
            if (prev && document.contains(prev)) {
              e.preventDefault();
              prev.focus({ preventScroll: true });
            }
          }}
          // width / positioning 契約（對應 holdings-detail-panel-rwd-extreme spec）：
          //   < sm(640)：!left-0 !right-0 !w-auto → 兩邊錨定、寬度=viewport，
          //     避免 base variant 的 w-3/4 + border-l + Radix ScrollLock 補償變數
          //     在窄寬度／折疊機出現 sub-pixel 漂移導致 panel-right 越過 viewport
          //   ≥ sm：!left-auto 切回右側 docked，!max-w-* 用 !important 蓋 base sm:max-w-sm
          //   全部強制 box-border + max-w-[100vw]（extreme 硬上限保險絲）
          // ≥sm 用「固定寬度」而非 w-auto：w-auto 會 shrink-to-fit，寬度隨當日
          // 價格/文案長度浮動（同斷點出現 543/576/605 三種寬），視覺快照永遠對不齊。
          // 固定成各斷點的 max-w 值後，寬度只由斷點決定，快照可重現。
          className="holdings-sheet-content box-border !left-0 !right-0 !w-auto sm:!left-auto sm:!w-[28rem] md:!w-[32rem] lg:!w-[36rem] xl:!w-[42rem] sm:!max-w-md md:!max-w-lg lg:!max-w-xl xl:!max-w-2xl !h-[100dvh] !max-h-[100dvh] overflow-y-auto p-0"
          style={{
            background: WB.surface,
            borderColor: WB.hairStrong,
            overscrollBehavior: 'contain',
            // iOS Safari: 100vh 會被 URL bar 遮住 → 用 100dvh；舊瀏覽器 fallback -webkit-fill-available
            // paddingBottom 保留 safe-area（home indicator）並額外墊 48px 讓最後一張卡不被遮
            WebkitOverflowScrolling: 'touch',
          }}
        >
          <VisuallyHidden asChild>
            <SheetHeader>
              <SheetTitle>
                {selected ? `持倉細節 ${selected.code}` : '持倉細節'}
              </SheetTitle>
              <SheetDescription>
                成本／區間／量價 + PNG·PDF 匯出。按 Esc 或點擊遮罩可關閉。
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
                openHoldingDrawer={openResearchNote}
                totalPortfolioValue={totalVal || 0}
                sparkData30D={sparklines?.[selected.code] || []}
                sortBy={sortBy}
                sortDir={sortDir}
                setSortBy={setSortBy}
                setSortDir={setSortDir}
                tradeLog={tradeLog}
                onReportMeta={handleReportMeta}
              />
            </Suspense>
          )}
          {/* 底部保留區：讓最後一張卡完整可見，並吃 iOS safe-area */}
          <div aria-hidden className="holdings-sheet-bottom-spacer" />
          {/* 「回到頂部」按鈕：always mounted，透過 CSS 顯隱，避免 tree 變動觸發 FocusScope 重新 focus 導致 scrollTop 被重置。*/}
          <button
            type="button"
            aria-label="回到頂部"
            data-testid="holdings-sheet-back-to-top"
            aria-hidden={!showTopBtn}
            tabIndex={showTopBtn ? 0 : -1}
            onClick={() =>
              sheetRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
            }
            className="holdings-sheet-top-btn fixed z-50 flex h-11 w-11 items-center justify-center rounded-full border focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-opacity"
            style={{
              background: WB.surface,
              borderColor: WB.hairStrong,
              color: WB.ink,
              opacity: showTopBtn ? 1 : 0,
              pointerEvents: showTopBtn ? 'auto' : 'none',
            }}
          >
            <ArrowUp className="h-5 w-5" />
            <span className="sr-only">回到頂部</span>
          </button>

        </SheetContent>
      </Sheet>

    </div>
  );
}

export default memo(HoldingsWorkbench);
