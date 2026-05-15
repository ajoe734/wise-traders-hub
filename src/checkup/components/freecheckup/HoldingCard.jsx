// HoldingCard — 抽自 FreeCheckup.jsx renderCard()。
// React.memo 包裝，跑 shallow compare：
//   - holding / decision / target / meta / sparkData：父層 useMemo 後 reference 穩定
//   - WB / Sparkline / alpha：module-level 常數，永遠 ===
//   - onSelect / onOpenDrawer：父層用 useCallback + ref pattern 提供穩定 reference
// 結果：每秒 quote tick 不會重渲染未變動的卡片。
//
// 設計憲法（不可違反）：
//   - 配色由 props.WB 決定；不直接寫 hex（除了反白透明色）
//   - fontSize 動態 clamp 已含媒體查詢，需保持 className="wb-roi" / "wb-card" 等
//   - 行為對等：onClick toggle expandedDecision、onDoubleClick + Shift+Enter 開 drawer
import { memo } from 'react';
import { validateProps } from './_validateProps.js';

// ── 模組層常數（搬離 renderCard 內部，避免每次重建） ──
const SRC_LABEL = { screenshot: '截圖', live: '即時', high: '最高', ask: '賣一', yclose: '昨收' };

// 智慧斷句：在限制長度內找最後一個標點
const truncateAction = (txt, limit) => {
  if (!txt || txt.length <= limit) return txt;
  const head = txt.slice(0, limit);
  const m = head.match(/^(.*[。、，；！？,.;!?])[^。、，；！？,.;!?]*$/);
  const cut = m ? m[1] : head.slice(0, limit - 2);
  return cut + '…';
};

const HOLDING_CARD_PROP_SCHEMA = {
  holding: 'object',
  decision: { type: 'object', optional: true },
  target: { type: 'object', optional: true },
  avgTargetPrice: { type: 'number', optional: true },
  meta: { type: 'object', optional: true },
  sparkData: 'array',
  sparkFailed: 'boolean',
  variant: 'string',
  isFeatureSlot: 'boolean',
  isActive: 'boolean',
  WB: 'object',
  Sparkline: 'function',
  alpha: 'function',
  onSelect: 'function',
  onOpenDrawer: 'function',
};

function HoldingCardImpl(props) {
  validateProps('HoldingCard', props, HOLDING_CARD_PROP_SCHEMA);

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
    WB,
    Sparkline,
    alpha,
    onSelect,
    onOpenDrawer,
  } = props;

  const actionLabel = dec?.actionType === 'exit' ? 'EXIT' : dec?.actionType === 'review' ? 'REVIEW' : 'HOLD';

  // 漲跌幅：成本與現價都存在時，用「現價/成本-1」現場重算
  const _costNum = Number(h.cost);
  const _priceNum = Number(h.price);
  const pctVal = (_costNum > 0 && Number.isFinite(_priceNum))
    ? ((_priceNum / _costNum) - 1) * 100
    : (h.pct ?? 0);
  const pnlVal = (_costNum > 0 && Number.isFinite(_priceNum) && Number.isFinite(Number(h.qty)))
    ? Math.round((_priceNum - _costNum) * Number(h.qty))
    : Math.round(h.pnl || 0);

  const upside = (tp && h.price) ? ((tp - h.price) / h.price * 100) : null;

  const isInk = variant === 'ink';
  const cardBg = isInk ? WB.ink : WB.surface;
  const cardColor = isInk ? '#F4F1EC' : WB.ink;
  const cardBorder = isInk ? 'none' : `1px solid ${isActive ? WB.hairStrong : WB.hair}`;
  const MIN_H = 320;

  const muteColor = isInk ? 'rgba(244,241,236,0.50)' : WB.inkLight;
  const subColor = isInk ? 'rgba(244,241,236,0.80)' : WB.inkSub;
  const hairColor = isInk ? 'rgba(244,241,236,0.14)' : WB.hair;
  const lossColor = isInk ? 'rgba(244,241,236,0.55)' : '#8A857F';
  const pnlColor = pctVal > 0 ? WB.accent : pctVal < 0 ? lossColor : muteColor;
  const pnlWeight = pctVal > 0 ? 500 : 400;
  const pnlArrow = pctVal > 0 ? '↑' : pctVal < 0 ? '↓' : '';

  const srcLabel = h.priceSource ? SRC_LABEL[h.priceSource] : null;
  const srcTitle = h.priceError
    ? `報價問題：${h.priceError}`
    : h.priceUpdatedAt
      ? `來源：${srcLabel || '—'}　更新於 ${new Date(h.priceUpdatedAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`
      : '尚未同步即時報價';

  const ariaLabel = `${h.name || ''} ${h.code}，決策 ${actionLabel === 'EXIT' ? '建議出場' : actionLabel === 'REVIEW' ? '需要檢查' : '維持持有'}，報酬率 ${pctVal >= 0 ? '+' : ''}${pctVal.toFixed(2)}%，損益 ${pnlVal >= 0 ? '+' : ''}${pnlVal.toLocaleString()}`;

  const handleClick = () => onSelect(h.code);
  const handleDoubleClick = () => onOpenDrawer(h.code);
  const handleKeyDown = (e) => {
    if (e.shiftKey && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onOpenDrawer(h.code);
    }
  };

  // ─── Feature card (ink + span 2) ───
  if (isInk && isFeatureSlot) {
    return (
      <button
        key={h.code}
        className="wb-card wb-card-feature wb-span-feature"
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        aria-label={ariaLabel}
        aria-pressed={isActive}
        style={{
          position: 'relative',
          minHeight: MIN_H,
          textAlign: 'left',
          background: cardBg,
          border: 'none',
          borderRadius: 0,
          padding: '24px 28px 20px',
          cursor: 'pointer',
          display: 'flex', flexDirection: 'column',
          transition: 'background 160ms ease',
          fontFamily: 'inherit',
          color: cardColor,
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 11, color: muteColor, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.04em' }}>{h.code}</span>
            <span style={{ fontSize: 15, fontWeight: 400, color: cardColor, letterSpacing: '-0.005em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.name}</span>
            {h.qty != null && (
              <span style={{ fontSize: 10, color: muteColor, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.04em', flexShrink: 0 }}>× {Number(h.qty).toLocaleString()}{h.unit ? ` ${h.unit}` : ' 股'}</span>
            )}
          </div>
          {sparkData.length >= 2 ? (
            <span className="wb-spark" style={{ display: 'inline-flex', flexShrink: 0 }}>
              <Sparkline data={sparkData} width={60} height={20} color={isInk ? '#F4F1EC' : (pctVal >= 0 ? WB.accent : '#9B968D')} opacity={pctVal >= 0 ? 0.85 : 0.6} />
            </span>
          ) : (
            <span className="wb-spark" aria-hidden title={sparkFailed ? '歷史價尚未同步，稍後重試' : undefined} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 60, height: 20, fontSize: 11, color: muteColor, opacity: 0.4, flexShrink: 0, letterSpacing: '0.3em' }}>{sparkFailed ? '~' : '———'}</span>
          )}
          <span style={{
            fontSize: 9, fontWeight: 500, letterSpacing: '0.20em',
            color: WB.accent, textTransform: 'uppercase', flexShrink: 0,
          }}>{actionLabel}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginTop: 8, marginBottom: 10 }}>
          <span className="wb-roi" style={{
            fontSize: 'clamp(40px, 6vw + 12px, 64px)', fontWeight: pnlWeight, color: pnlColor,
            letterSpacing: '-0.04em', lineHeight: 1,
            fontVariantNumeric: 'tabular-nums',
            display: 'inline-flex', alignItems: 'baseline', gap: 6,
          }}>
            {pnlArrow && <span style={{ fontSize: '0.40em', opacity: 0.7, fontWeight: 400 }}>{pnlArrow}</span>}
            <span>{pctVal >= 0 ? '+' : ''}{pctVal.toFixed(2)}<span style={{ fontSize: '0.55em', marginLeft: 3, opacity: 0.6, fontWeight: 500, verticalAlign: 'baseline' }}>%</span></span>
          </span>
          <span style={{ fontSize: 13, color: subColor, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.02em' }}>
            {pnlVal >= 0 ? '+' : ''}{pnlVal.toLocaleString()}
          </span>
        </div>

        <div style={{
          display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10,
          fontSize: 11, color: subColor, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.04em',
        }}>
          <span style={{ color: muteColor, letterSpacing: '0.12em', fontSize: 9, opacity: 0.8 }}>成本</span>
          <span>{h.cost != null ? Number(h.cost).toFixed(2) : '—'}</span>
          <span style={{ color: muteColor, opacity: 0.6 }}>→</span>
          <span style={{ color: muteColor, letterSpacing: '0.12em', fontSize: 9, opacity: 0.8 }}>現價</span>
          <span>{h.price != null ? Number(h.price).toFixed(2) : '—'}</span>
        </div>

        {(meta?.industry || meta?.strategy) && (
          <div className="wb-tags" style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            {meta?.industry && (
              <span style={{ fontSize: 10, color: 'rgba(244,241,236,0.78)', letterSpacing: '0.08em', padding: '4px 8px', background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 0 }}>{meta.industry}</span>
            )}
            {meta?.strategy && (
              <span style={{ fontSize: 10, color: 'rgba(244,241,236,0.78)', letterSpacing: '0.08em', padding: '4px 8px', background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 0 }}>{meta.strategy}</span>
            )}
          </div>
        )}

        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 18, minHeight: 48 }}>
          <div style={{ flex: 1, fontSize: 11, color: subColor, lineHeight: 1.7, letterSpacing: '0.01em' }}>
            {dec?.actionText
              ? truncateAction(dec.actionText, 90)
              : (meta?.strategy || '持續監控基本面與籌碼變動。')}
          </div>
        </div>

        <div className="wb-bottom" style={{
          paddingTop: 12, marginTop: 8,
          borderTop: `1px solid ${hairColor}`,
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) 1px minmax(0,1fr)',
          gridTemplateRows: 'auto auto',
          columnGap: 16, rowGap: 2,
          alignItems: 'baseline',
        }}>
          <span style={{ gridColumn: '1', gridRow: '1', fontSize: 9, color: muteColor, letterSpacing: '0.16em', opacity: 0.7, lineHeight: 1 }}>TODAY</span>
          <span style={{ gridColumn: '3', gridRow: '1', display: 'flex', alignItems: 'center', gap: 6, fontSize: 9, color: muteColor, letterSpacing: '0.16em', opacity: 0.7, lineHeight: 1 }}>
            <span>VALUE</span>
            {srcLabel && (
              <span title={srcTitle} style={{
                fontSize: 8, letterSpacing: '0.06em', padding: '1px 5px', borderRadius: 2,
                background: h.priceSource === 'live' ? alpha(WB.accent, '30') : 'rgba(244,241,236,0.10)',
                color: h.priceSource === 'live' ? WB.accent : 'rgba(244,241,236,0.85)',
                opacity: 0.9, fontWeight: 500,
              }}>{srcLabel}</span>
            )}
            {h.priceError && !srcLabel && (
              <span title={h.priceError} style={{ fontSize: 8, padding: '1px 5px', borderRadius: 2, background: 'rgba(244,241,236,0.12)', color: 'rgba(244,241,236,0.65)' }}>失敗</span>
            )}
          </span>
          <div style={{ gridColumn: '2', gridRow: '1 / span 2', background: hairColor, width: 1, height: '100%' }} />
          <span className="wb-bottom-val" style={{ gridColumn: '1', gridRow: '2', fontSize: 'clamp(10.5px, 0.9vw + 8px, 12px)', color: subColor, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
            {pnlVal >= 0 ? '+' : ''}{pnlVal.toLocaleString()}
            <span style={{ marginLeft: 6, color: muteColor }}>{pctVal >= 0 ? '+' : ''}{pctVal.toFixed(2)}%</span>
          </span>
          <span className="wb-bottom-val" style={{ gridColumn: '3', gridRow: '2', fontSize: 'clamp(10.5px, 0.9vw + 8px, 12px)', color: subColor, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
            {h.value?.toLocaleString() || '—'}
            {tp && upside != null && (
              <span style={{ marginLeft: 6, color: muteColor }}>TGT {upside >= 0 ? '+' : ''}{upside.toFixed(1)}%</span>
            )}
          </span>
        </div>
      </button>
    );
  }

  // ─── Normal card ───
  return (
    <button
      key={h.code}
      className="wb-card wb-span-1"
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      aria-label={ariaLabel}
      aria-pressed={isActive}
      style={{
        position: 'relative',
        minHeight: MIN_H,
        textAlign: 'left',
        background: cardBg,
        border: cardBorder,
        borderRadius: 0,
        padding: '22px 22px 18px',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        transition: 'background 160ms ease, border-color 160ms ease',
        fontFamily: 'inherit',
        color: cardColor,
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 11, color: muteColor, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.04em', flexShrink: 0 }}>{h.code}</span>
          <span style={{ fontSize: 13, fontWeight: 400, color: cardColor, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.name}</span>
          {h.qty != null && (
            <span style={{ fontSize: 10, color: muteColor, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.04em', flexShrink: 0 }}>× {Number(h.qty).toLocaleString()}{h.unit ? ` ${h.unit}` : ' 股'}</span>
          )}
        </div>
        {sparkData.length >= 2 ? (
          <span className="wb-spark" style={{ display: 'inline-flex', flexShrink: 0 }}>
            <Sparkline data={sparkData} width={60} height={20} color={pctVal >= 0 ? WB.accent : '#9B968D'} opacity={pctVal >= 0 ? 0.85 : 0.55} />
          </span>
        ) : (
          <span className="wb-spark" aria-hidden title={sparkFailed ? '歷史價尚未同步，稍後重試' : undefined} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 60, height: 20, fontSize: 11, color: muteColor, opacity: 0.4, flexShrink: 0, letterSpacing: '0.3em' }}>{sparkFailed ? '~' : '———'}</span>
        )}
        <span style={{
          fontSize: 9, fontWeight: 500, letterSpacing: '0.20em',
          color: WB.accent, flexShrink: 0,
        }}>{actionLabel}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 8, marginBottom: 8 }}>
        <span className="wb-roi" style={{
          fontSize: 'clamp(36px, 4.5vw + 10px, 52px)', fontWeight: pnlWeight, color: pnlColor,
          letterSpacing: '-0.035em', lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
          display: 'inline-flex', alignItems: 'baseline', gap: 5,
        }}>
          {pnlArrow && <span style={{ fontSize: '0.40em', opacity: 0.7, fontWeight: 400 }}>{pnlArrow}</span>}
          <span>{pctVal >= 0 ? '+' : ''}{pctVal.toFixed(2)}<span style={{ fontSize: '0.55em', marginLeft: 3, opacity: 0.6, fontWeight: 500, verticalAlign: 'baseline' }}>%</span></span>
        </span>
      </div>

      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8,
        fontSize: 11, color: subColor, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.04em',
      }}>
        <span style={{ color: muteColor, letterSpacing: '0.12em', fontSize: 9, opacity: 0.8 }}>成本</span>
        <span>{h.cost != null ? Number(h.cost).toFixed(2) : '—'}</span>
        <span style={{ color: muteColor, opacity: 0.6 }}>→</span>
        <span style={{ color: muteColor, letterSpacing: '0.12em', fontSize: 9, opacity: 0.8 }}>現價</span>
        <span>{h.price != null ? Number(h.price).toFixed(2) : '—'}</span>
      </div>

      {(meta?.industry || meta?.strategy) && (
        <div className="wb-tags" style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
          {meta?.industry && (
            <span style={{ fontSize: 10, color: isInk ? 'rgba(244,241,236,0.78)' : WB.inkSub, letterSpacing: '0.08em', padding: '4px 8px', background: isInk ? 'rgba(255,255,255,0.08)' : '#F4F2EE', border: 'none', borderRadius: 0 }}>{meta.industry}</span>
          )}
          {meta?.strategy && (
            <span style={{ fontSize: 10, color: isInk ? 'rgba(244,241,236,0.78)' : WB.inkSub, letterSpacing: '0.08em', padding: '4px 8px', background: isInk ? 'rgba(255,255,255,0.08)' : '#F4F2EE', border: 'none', borderRadius: 0 }}>{meta.strategy}</span>
          )}
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 14, minHeight: 40, paddingTop: 4 }}>
        <div style={{ flex: 1, fontSize: 11, color: subColor, lineHeight: 1.65 }}>
          {dec?.actionText
            ? truncateAction(dec.actionText, 60)
            : (meta?.strategy ? meta.strategy.slice(0, 40) : '')}
        </div>
      </div>

      <div className="wb-bottom" style={{
        paddingTop: 10, marginTop: 8,
        borderTop: `1px solid ${hairColor}`,
        display: 'grid',
        gridTemplateColumns: 'minmax(0,1fr) 1px minmax(0,1fr)',
        gridTemplateRows: 'auto auto',
        columnGap: 12, rowGap: 2,
        alignItems: 'baseline',
        fontSize: 10, color: muteColor, fontWeight: 400,
        fontVariantNumeric: 'tabular-nums', letterSpacing: '0.06em',
      }}>
        <span style={{ gridColumn: '1', gridRow: '1', fontSize: 9, color: muteColor, letterSpacing: '0.16em', opacity: 0.7, lineHeight: 1 }}>TODAY</span>
        <span style={{ gridColumn: '3', gridRow: '1', display: 'flex', alignItems: 'center', gap: 6, fontSize: 9, color: muteColor, letterSpacing: '0.16em', opacity: 0.7, lineHeight: 1 }}>
          <span>VALUE</span>
          {srcLabel && (
            <span title={srcTitle} style={{
              fontSize: 8, letterSpacing: '0.06em', padding: '1px 5px', borderRadius: 2,
              background: h.priceSource === 'live' ? alpha(WB.accent, '22') : h.priceSource === 'screenshot' ? alpha(muteColor, '18') : alpha(lossColor, '22'),
              color: h.priceSource === 'live' ? WB.accent : subColor,
              opacity: 0.85, fontWeight: 500,
            }}>{srcLabel}</span>
          )}
          {h.priceError && !srcLabel && (
            <span title={h.priceError} style={{ fontSize: 8, padding: '1px 5px', borderRadius: 2, background: alpha(lossColor, '22'), color: lossColor }}>失敗</span>
          )}
        </span>
        <div style={{ gridColumn: '2', gridRow: '1 / span 2', background: hairColor, width: 1, height: '100%' }} />
        <span className="wb-bottom-val" style={{ gridColumn: '1', gridRow: '2', fontSize: 'clamp(10.5px, 0.9vw + 8px, 12px)', color: subColor, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
          {pnlVal >= 0 ? '+' : ''}{pnlVal.toLocaleString()}
          <span style={{ marginLeft: 6, color: muteColor }}>{pctVal >= 0 ? '+' : ''}{pctVal.toFixed(2)}%</span>
        </span>
        <span className="wb-bottom-val" style={{ gridColumn: '3', gridRow: '2', fontSize: 'clamp(10.5px, 0.9vw + 8px, 12px)', color: subColor, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
          {h.value?.toLocaleString() || '—'}
        </span>
      </div>
    </button>
  );
}

const HoldingCard = memo(HoldingCardImpl);
HoldingCard.displayName = 'HoldingCard';
export default HoldingCard;
