// @ts-nocheck — 漸進式 .jsx→.tsx 遷移（F-Maint-R4），完整型別化留待後續批次
/**
 * HoldingCard — 抽自 FreeCheckup.jsx renderCard()。
 *
 * ══ 四層架構（Monocle 版重構 2026-07）══
 *   1) HoldingCardHeader     — 代號 · 名稱 · 股數 · Sparkline · Action · 產業/策略 tag
 *   2) HoldingCardReturn     — 大字 ROI（%） ＋ 附屬損益（feature card only）
 *   3) HoldingCardPriceTrack — 成本→現價文字 ＋ 決策摘要
 *   4) HoldingCardFooter     — TODAY | VALUE 底部帶 ＋ 價格來源徽章
 *
 * 這裡（HoldingCard.tsx）負責：
 *   - React.memo 外殼、button 語意、a11y aria-*、prop validation
 *   - inView lazy render（useInView）
 *   - Sync overlay / error strip / SR-only status
 *   - 派生計算：pctVal, pnlVal, pnlColor, upside, hasToday...
 *   - 事件：onClick(select) / onDoubleClick(drawer) / Shift+Enter
 *
 * 憲法：
 *   - class name 保留 `wb-card` / `wb-card-feature` / `wb-span-feature` / `wb-span-1`
 *     以及子層的 `wb-spark` / `wb-tags` / `wb-roi` / `wb-bottom` / `wb-bottom-val`
 *     （既有 CSS media-query 與 e2e 截圖回歸依賴這些鈎子）
 *   - 配色統一走 WB（free-checkup 單色橘紅 #FF4D1F），不引入其他 accent
 *   - 行為對等：不新增、不刪除任何互動與 aria hook
 */
import { memo } from 'react';
import { validateProps } from '@/checkup/lib/validateProps.js';
import { useInView } from '@/checkup/hooks/useInView.js';
import { WB } from '@/pages/_freeCheckup/constants.jsx';
import { getSparkCloses } from '@/checkup/lib/holdingDetailViewModel';
import { trackRaw } from '@/lib/analytics/events';
import HoldingCardHeader from './_ui/holdingCard/HoldingCardHeader';
import HoldingCardReturn from './_ui/holdingCard/HoldingCardReturn';
import HoldingCardPriceTrack from './_ui/holdingCard/HoldingCardPriceTrack';
import HoldingCardFooter from './_ui/holdingCard/HoldingCardFooter';
import HoldingCardSkeleton from './_ui/holdingCard/HoldingCardSkeleton';
import HoldingCardBsr from './_ui/holdingCard/HoldingCardBsr';


const HOLDING_CARD_PROP_SCHEMA = {
  holding: 'object',
  decision: { type: 'object', optional: true },
  target: { type: 'object', optional: true },
  avgTargetPrice: { type: 'number', optional: true },
  meta: { type: 'object', optional: true },
  sparkData: { type: 'any', optional: true }, // number[] | { ohlc, closes }
  sparkFailed: 'boolean',
  variant: 'string',
  isFeatureSlot: 'boolean',
  isActive: 'boolean',
  syncState: { type: 'object', optional: true },
  onSelect: 'function',
  onOpenDrawer: 'function',
  onReportMeta: { type: 'function', optional: true },
  onPrefetch: { type: 'function', optional: true },
};


function HoldingCardImpl(props) {
  validateProps('HoldingCard', props, HOLDING_CARD_PROP_SCHEMA);
  // 卡片離視窗時延後渲染內容 — 減少初始 DOM/Sparkline SVG 成本
  const [cardRef, inView] = useInView({ rootMargin: '400px 0px' });

  const {
    holding: h,
    decision: dec,
    target: T,
    avgTargetPrice: tp,
    meta,
    sparkData,
    sparkFailed,
    variant,
    isFeatureSlot,
    isActive,
    syncState,
    onSelect,
    onOpenDrawer,
    onReportMeta,
    onPrefetch,
  } = props;

  const sparkCloses = getSparkCloses(sparkData);

  const actionLabel = dec?.actionType === 'exit'
    ? 'EXIT'
    : dec?.actionType === 'review' ? 'REVIEW' : 'HOLD';


  // 大字 ROI：現價 vs 成本
  const _costNum = Number(h.cost);
  const _priceNum = Number(h.price);
  const _qtyNum = Number(h.qty);
  const pctVal = (_costNum > 0 && Number.isFinite(_priceNum))
    ? ((_priceNum / _costNum) - 1) * 100
    : (h.pct ?? 0);
  const pnlVal = (_costNum > 0 && Number.isFinite(_priceNum) && Number.isFinite(_qtyNum))
    ? Math.round((_priceNum - _costNum) * _qtyNum)
    : Math.round(h.pnl || 0);

  // TODAY：現價 vs 昨收
  const todayPnlNum = Number.isFinite(Number(h.todayPnl)) ? Number(h.todayPnl) : null;
  const todayPctNum = Number.isFinite(Number(h.todayPct)) ? Number(h.todayPct) : null;
  const hasToday = todayPnlNum != null || todayPctNum != null;

  // Bug B8 fix：`(tp && h.price)` 對 price=0 誤判為 falsy → upside=null；且未擋 NaN/負價。
  const _priceForUpside = Number(h.price);
  const upside = (tp != null && Number.isFinite(_priceForUpside) && _priceForUpside > 0)
    ? ((tp - _priceForUpside) / _priceForUpside) * 100
    : null;

  // §3.4 定案：卡片全部同尺寸白底黑框，不再有 feature 黑底變體；箭頭 ↑/↓ 全刪，
  // 正負以 `+`/`−` 表達（Return 層處理）。variant/isFeatureSlot props 保留供上游相容。
  const isInk = false;
  const isFeature = false;
  const cardBg = '#FFFFFF';
  const cardColor = 'var(--cm-ink, #0A0A0A)';
  const cardBorder = `1px solid ${isActive ? 'var(--cm-ink, #0A0A0A)' : 'var(--cm-hair, #ECEAE5)'}`;
  const MIN_H = 200;

  const muteColor = 'var(--cm-ink-mute, #9B968D)';
  const subColor = 'var(--cm-ink-sub, #3A3A3A)';
  const hairColor = 'var(--cm-hair, #ECEAE5)';
  const lossColor = 'var(--cm-loss, #8A857F)';
  const pnlColor = pctVal > 0 ? 'var(--cm-accent, #FF4D1F)' : pctVal < 0 ? lossColor : muteColor;
  const pnlWeight = pctVal > 0 ? 500 : 400;


  const ariaLabel = `${h.name || ''} ${h.code}，決策 ${
    actionLabel === 'EXIT' ? '建議出場' : actionLabel === 'REVIEW' ? '需要檢查' : '維持持有'
  }，報酬率 ${pctVal >= 0 ? '+' : ''}${pctVal.toFixed(2)}%，損益 ${
    pnlVal >= 0 ? '+' : ''}${pnlVal.toLocaleString()}。按 Enter 展開資料，Shift + Enter 開啟決策抽屜。`;

  // H4/H5 局部 loading / error 狀態（由 FreeCheckup triggerServerSync 標註）
  const isCardSyncing = !!(syncState?.syncing || h._syncing);
  const cardSyncError = syncState?.error || h._syncError || null;
  const cardLabel = `${h.name || ''} ${h.code}`.trim();
  const errStripId = `holding-card-error-${h.code}`;
  const statusRegionId = `holding-card-status-${h.code}`;

  const SyncOverlay = isCardSyncing ? (
    <div
      data-testid="holding-card-loading"
      aria-hidden
      style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'rgba(255,255,255,0.35)',
        zIndex: 3,
      }}
    />
  ) : null;

  const SyncErrorStrip = cardSyncError ? (
    <div
      id={errStripId}
      data-testid="holding-card-error"
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        padding: '4px 10px',
        fontSize: 10, fontWeight: 500, letterSpacing: '0.04em',
        color: '#fff', background: '#c8362c',
        display: 'flex', alignItems: 'center', gap: 6,
        zIndex: 4,
      }}
    >
      <span aria-hidden>✕</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <span className="sr-only">{cardLabel} 更新失敗：</span>{cardSyncError}
      </span>
    </div>
  ) : null;

  const SyncSrStatus = (
    <span
      id={statusRegionId}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      style={{
        position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
        overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
      }}
    >
      {isCardSyncing
        ? `正在更新 ${cardLabel} 現價…`
        : cardSyncError
          ? ''
          : (h.priceUpdatedAt ? `${cardLabel} 現價已更新` : '')}
    </span>
  );

  const describedByIds = [
    cardSyncError ? errStripId : null,
    isCardSyncing ? statusRegionId : null,
  ].filter(Boolean).join(' ') || undefined;

  const handleClick = () => { trackRaw('checkup_holding_expand', { code: h.code }); onSelect(h.code); };
  const handleDoubleClick = () => onOpenDrawer(h.code);
  const handleKeyDown = (e) => {
    if (e.shiftKey && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onOpenDrawer(h.code);
    }
  };

  // ── §3.4：所有卡片同一外殼 ──
  const buttonClass = 'wb-card wb-span-1';
  const buttonStyle = {
    position: 'relative', minHeight: MIN_H, textAlign: 'left',
    background: cardBg, border: cardBorder, borderRadius: 0,
    padding: '18px 20px 14px', cursor: 'pointer',
    display: 'flex', flexDirection: 'column',
    transition: 'background 160ms ease, border-color 160ms ease',
    fontFamily: 'inherit', color: cardColor, overflow: 'hidden',
  };

  const variantForChildren = 'normal';


  return (
    <button
      ref={cardRef}
      type="button"
      className={buttonClass}
      data-holding-code={h.code}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => onPrefetch?.(h.code)}
      onFocus={() => onPrefetch?.(h.code)}
      aria-label={ariaLabel}
      aria-pressed={isActive}
      aria-busy={isCardSyncing || undefined}
      aria-describedby={describedByIds}
      aria-keyshortcuts="Shift+Enter"
      title="Enter 展開；Shift + Enter 開啟決策抽屜"
      style={buttonStyle}
    >
      {(!inView || h?._loading) ? (
        <HoldingCardSkeleton variant={variantForChildren} />
      ) : (
        <>
          {/* Layer 1 · 標頭 */}
          <HoldingCardHeader
            h={h}
            meta={meta}
            variant={variantForChildren}
            cardColor={cardColor}
            muteColor={muteColor}
            sparkData={sparkCloses}
            sparkFailed={sparkFailed}
            actionLabel={actionLabel}
            pctVal={pctVal}
          />

          {/* Layer 2 · 報酬條 */}
          <HoldingCardReturn
            pctVal={pctVal}
            pnlVal={pnlVal}
            pnlColor={pnlColor}
            pnlWeight={pnlWeight}
            subColor={subColor}
            variant={variantForChildren}
          />


          {/* Layer 3 · 價格軌 */}
          <HoldingCardPriceTrack
            h={h}
            meta={meta}
            dec={dec}
            subColor={subColor}
            muteColor={muteColor}
            variant={variantForChildren}
          />

          {/* Layer 4 · 頁腳 */}
          <HoldingCardFooter
            h={h}
            tp={tp}
            upside={upside}
            hasToday={hasToday}
            todayPnlNum={todayPnlNum}
            todayPctNum={todayPctNum}
            variant={variantForChildren}
            subColor={subColor}
            muteColor={muteColor}
            hairColor={hairColor}
            lossColor={lossColor}
          />
        </>
      )}
      {SyncOverlay}
      {SyncErrorStrip}
      {SyncSrStatus}
      {/* 卡片層籌碼狀態：只訂閱快取，不發請求、不碰任何持倉數字 */}
      <HoldingCardBsr code={h.code} suppressStrip={!!cardSyncError} />
    </button>
  );
}

const HoldingCard = memo(HoldingCardImpl);
HoldingCard.displayName = 'HoldingCard';
export default HoldingCard;
