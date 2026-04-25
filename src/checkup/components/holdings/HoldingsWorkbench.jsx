// @template-only — 樣板元件，未被 /free-checkup 引用，請見 ./README.md

import HoldingHero from './HoldingHero.jsx';
import PriorityStrip from './PriorityStrip.jsx';
import HoldingCard from './HoldingCard.jsx';
import HoldingDetailPanel from './HoldingDetailPanel.jsx';
import { HOLDINGS_TOKENS } from './holdingsTokens.js';
import { assignCardVariants } from '../../hooks/useHoldingDecision.js';

/**
 * HoldingsWorkbench — 持倉決策工作台容器
 *
 * 桌面版：左卡片牆 (3 欄) + 右 sticky Detail Panel
 * 行動版：單欄卡片流，Detail 隱藏（透過 onOpenDrawer 開啟外部 drawer）
 */
export default function HoldingsWorkbench({
  // hero
  totalCost = 0,
  totalValue = 0,
  totalPnl = 0,
  totalPct = 0,
  todayPnl = null,
  todayPct = null,
  // 持倉資料
  holdings = [],
  decisionsMap = {},
  stockMeta = {},
  targets = {},
  avgTarget = () => null,
  normalizedEvents = [],
  // 顯示控制
  showAll = false,
  setShowAll = () => {},
  // 選中狀態
  selectedCode = null,
  setSelectedCode = () => {},
  // 操作
  openHoldingDrawer = () => {},
  userOverrides = {},
  onOverrideToHold = () => {},
}) {
  const displayed = showAll ? holdings : holdings.slice(0, 12);

  // 計算卡片變體配額
  const variantMap = assignCardVariants(
    displayed.map((h) => ({
      code: h.code,
      actionType: decisionsMap[h.code]?.actionType || 'hold',
      pct: h.pct ?? 0,
    })),
    {
      getActionType: (it) => it.actionType,
      getPct: (it) => it.pct,
    }
  );

  // 今日優先：以 decisionsMap 排序前 6 檔（exit + review，依緊急度）
  const priorityItems = holdings
    .filter((h) => {
      const k = decisionsMap[h.code]?.actionType;
      return k === 'exit' || k === 'review';
    })
    .map((h) => ({
      code: h.code,
      name: h.name,
      pct: h.pct ?? 0,
      actionType: decisionsMap[h.code]?.actionType,
    }))
    .sort((a, b) => {
      // exit 優先
      if (a.actionType === 'exit' && b.actionType !== 'exit') return -1;
      if (b.actionType === 'exit' && a.actionType !== 'exit') return 1;
      // 同類別按 |pct| 降冪
      return Math.abs(b.pct) - Math.abs(a.pct);
    });

  const selected = selectedCode
    ? holdings.find((h) => h.code === selectedCode) || null
    : null;
  const selectedDecision = selected ? decisionsMap[selected.code] : null;
  const selectedMeta = selected ? stockMeta[selected.code] || null : null;
  const selectedTargetEntry = selected ? targets?.[selected.code] : null;
  const selectedTp =
    selectedTargetEntry && selected ? avgTarget(selected.code) : null;
  const selectedUpside =
    selectedTp && selected?.price
      ? ((selectedTp - selected.price) / selected.price) * 100
      : null;
  const selectedRelatedEvents = selected
    ? (normalizedEvents || []).filter(
        (e) =>
          (e.relatedCodes || []).includes(selected.code) && e.source !== 'demo'
      )
    : [];

  return (
    <div className="holdings-workbench-root">
      {/* Hero 摘要 */}
      <HoldingHero
        totalCost={totalCost}
        totalValue={totalValue}
        totalPnl={totalPnl}
        totalPct={totalPct}
        todayPnl={todayPnl}
        todayPct={todayPct}
        positionCount={holdings.length}
      />

      {/* 今日優先 */}
      <PriorityStrip
        items={priorityItems}
        selectedCode={selectedCode}
        onSelect={setSelectedCode}
      />

      {/* 主區：卡片牆 + Detail Panel */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 360px)',
          gap: 24,
          alignItems: 'flex-start',
        }}
        className="holdings-workbench"
      >
        {/* 左：卡片牆 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: HOLDINGS_TOKENS.cardGap,
          }}
          className="holdings-card-grid"
        >
          {displayed.length === 0 ? (
            <div
              style={{
                gridColumn: '1 / -1',
                padding: '48px 16px',
                textAlign: 'center',
                color: HOLDINGS_TOKENS.inkLight,
                fontSize: 13,
                letterSpacing: '0.04em',
              }}
            >
              尚無持股
            </div>
          ) : (
            displayed.map((h) => {
              const variant = variantMap.get(h.code) || 'plain';
              const dec = decisionsMap[h.code];
              return (
                <HoldingCard
                  key={h.code}
                  holding={h}
                  variant={variant}
                  actionType={dec?.actionType || 'hold'}
                  pct={h.pct ?? 0}
                  pnl={h.pnl ?? 0}
                  value={h.value ?? 0}
                  meta={stockMeta[h.code] || null}
                  isActive={selectedCode === h.code}
                  onSelect={(code) =>
                    setSelectedCode(selectedCode === code ? null : code)
                  }
                  onOpenDrawer={openHoldingDrawer}
                />
              );
            })
          )}
          {!showAll && holdings.length > 12 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              style={{
                gridColumn: '1 / -1',
                padding: 12,
                background: 'transparent',
                border: `1px dashed ${HOLDINGS_TOKENS.hairStrong}`,
                borderRadius: HOLDINGS_TOKENS.radius,
                color: HOLDINGS_TOKENS.inkMute,
                fontSize: 12,
                cursor: 'pointer',
                letterSpacing: '0.06em',
                fontFamily: 'inherit',
              }}
            >
              顯示全部 {holdings.length} 檔
            </button>
          )}
        </div>

        {/* 右：Detail Panel */}
        <aside
          className="holdings-detail-panel"
          style={{
            position: 'sticky',
            top: 12,
            background: HOLDINGS_TOKENS.surface,
            border: `1px solid ${HOLDINGS_TOKENS.hair}`,
            borderRadius: HOLDINGS_TOKENS.radius,
            padding: '20px 18px',
            maxHeight: 'calc(100vh - 24px)',
            overflowY: 'auto',
          }}
        >
          <HoldingDetailPanel
            selected={selected}
            decision={selectedDecision}
            meta={selectedMeta}
            targetPrice={selectedTp}
            upside={selectedUpside}
            relatedEvents={selectedRelatedEvents}
            onOpenDrawer={openHoldingDrawer}
            onOverrideToHold={onOverrideToHold}
            hasOverride={selected ? !!userOverrides[selected.code] : false}
          />
        </aside>
      </div>

      <style>{`
        @media (max-width: 1279px) {
          .holdings-workbench .holdings-card-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        @media (max-width: 1023px) {
          .holdings-workbench {
            grid-template-columns: 1fr !important;
          }
          .holdings-detail-panel {
            display: none !important;
          }
        }
        @media (max-width: 640px) {
          .holdings-workbench .holdings-card-grid {
            grid-template-columns: 1fr !important;
          }
          .holdings-hero {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
            gap: 14px;
          }
        }
      `}</style>
    </div>
  );
}
