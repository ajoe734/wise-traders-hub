import { CARD_VARIANTS, HOLDINGS_TOKENS, valueColor, valueArrow, valueWeight } from './holdingsTokens.js';

const labelOf = (kind) => {
  if (kind === 'exit') return '出場';
  if (kind === 'review') return '檢視';
  if (kind === 'add') return '加碼';
  return '續抱';
};

const fmt = (n) =>
  typeof n === 'number' && Number.isFinite(n) ? Math.round(n).toLocaleString() : '—';

/**
 * HoldingCard — 統一卡片版型（三變體共用骨架）
 *
 * 結構由上而下固定：
 *   1. Header   股名 + 代碼 + 狀態標籤
 *   2. Hero     報酬率 (主視覺) + 絕對損益
 *   3. Tags     標的 metadata (產業/週期等)
 *   4. Footer   qty · 成本 · 市值 (固定資訊密度)
 *
 * 變體：
 *   - ink     深底白字、span 2、最大字
 *   - accent  白底 + 左橘條、span 1、中字
 *   - plain   白底 + 細外框、span 1、標準字
 */
export default function HoldingCard({
  holding,
  variant = 'plain',
  actionType = 'hold',
  pct = 0,
  pnl = 0,
  value = 0,
  meta = null,
  isActive = false,
  onSelect = () => {},
  onOpenDrawer = () => {},
}) {
  const v = CARD_VARIANTS[variant] || CARD_VARIANTS.plain;
  const isInk = variant === 'ink';
  const isAccent = variant === 'accent';

  // 文字顏色（在 ink 卡上需要反白系，且漲跌色需要更柔和）
  const titleColor = isInk ? HOLDINGS_TOKENS.paper : HOLDINGS_TOKENS.ink;
  const muteColor = isInk ? 'rgba(239,237,232,0.55)' : HOLDINGS_TOKENS.inkLight;
  const subColor = isInk ? 'rgba(239,237,232,0.75)' : HOLDINGS_TOKENS.inkMute;

  // 漲跌色：ink 卡背景太深，紅綠不易識別 → 用白系 + 三角符號標示方向
  let pctColor;
  if (isInk) {
    pctColor = HOLDINGS_TOKENS.paper;
  } else {
    pctColor = valueColor(pct);
  }

  const tagBorder = isInk ? 'rgba(239,237,232,0.22)' : HOLDINGS_TOKENS.hair;

  return (
    <button
      type="button"
      onClick={() => onSelect(holding?.code)}
      onDoubleClick={() => onOpenDrawer(holding?.code)}
      style={{
        position: 'relative',
        gridColumn: `span ${v.span}`,
        minHeight: v.minHeight,
        background: v.background,
        color: v.color,
        border: v.border,
        borderRadius: HOLDINGS_TOKENS.radius,
        padding: `${HOLDINGS_TOKENS.cardPaddingY}px ${HOLDINGS_TOKENS.cardPaddingX}px`,
        textAlign: 'left',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        fontFamily: 'inherit',
        transition: 'background 140ms ease, border-color 140ms ease',
        outline: isActive
          ? `2px solid ${isInk ? HOLDINGS_TOKENS.accent : HOLDINGS_TOKENS.ink}`
          : 'none',
        outlineOffset: isActive ? -1 : 0,
        overflow: 'hidden',
      }}
    >
      {/* 左側橘色細條（accent 卡） */}
      {v.accentBar && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            width: HOLDINGS_TOKENS.accentBarWidth,
            background: v.accentBar,
          }}
        />
      )}

      {/* 1. Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
          <span
            style={{
              fontSize: HOLDINGS_TOKENS.fontTitle,
              fontWeight: 500,
              color: titleColor,
              letterSpacing: '0.02em',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {holding?.name || holding?.code}
          </span>
          <span
            style={{
              fontSize: HOLDINGS_TOKENS.fontMeta,
              color: muteColor,
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: '0.04em',
              flexShrink: 0,
            }}
          >
            {holding?.code}
          </span>
        </div>
        <span
          style={{
            fontSize: 10,
            color: isInk ? HOLDINGS_TOKENS.paper : HOLDINGS_TOKENS.ink,
            background: isAccent
              ? HOLDINGS_TOKENS.accentSoft
              : isInk
              ? 'rgba(239,237,232,0.10)'
              : 'transparent',
            border: `1px solid ${
              isAccent
                ? 'rgba(236,102,45,0.40)'
                : isInk
                ? 'rgba(239,237,232,0.30)'
                : HOLDINGS_TOKENS.hairStrong
            }`,
            padding: '2px 8px',
            borderRadius: 999,
            letterSpacing: '0.08em',
            fontWeight: 500,
            flexShrink: 0,
          }}
        >
          {labelOf(actionType)}
        </span>
      </div>

      {/* 2. Hero — 報酬率主視覺 */}
      <div style={{ marginTop: 'auto' }}>
        <div
          style={{
            fontSize: v.fontHero,
            fontWeight: isInk ? 400 : valueWeight(pct),
            color: pctColor,
            letterSpacing: '-0.02em',
            lineHeight: 1,
            fontVariantNumeric: 'tabular-nums',
            display: 'flex',
            alignItems: 'baseline',
            gap: 6,
          }}
        >
          {!isInk && valueArrow(pct) && (
            <span
              aria-hidden
              style={{
                fontSize: '0.42em',
                opacity: 0.7,
                fontWeight: 400,
                marginRight: -2,
              }}
            >
              {valueArrow(pct)}
            </span>
          )}
          <span>
            {pct >= 0 ? '+' : ''}
            {Number(pct).toFixed(2)}
          </span>
          <span style={{ fontSize: '0.5em', opacity: 0.6 }}>%</span>
        </div>
        <div
          style={{
            marginTop: 6,
            fontSize: 13,
            color: subColor,
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '0.02em',
          }}
        >
          {pnl >= 0 ? '+' : ''}
          NT$ {fmt(pnl)}
        </div>
      </div>

      {/* 3. Tags */}
      {(meta?.industry || meta?.strategy || meta?.period) && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
            marginTop: 4,
          }}
        >
          {meta?.industry && (
            <span
              style={{
                fontSize: 10,
                color: muteColor,
                padding: '2px 8px',
                borderRadius: 999,
                border: `1px solid ${tagBorder}`,
                letterSpacing: '0.04em',
              }}
            >
              {meta.industry}
            </span>
          )}
          {meta?.strategy && (
            <span
              style={{
                fontSize: 10,
                color: muteColor,
                padding: '2px 8px',
                borderRadius: 999,
                border: `1px solid ${tagBorder}`,
                letterSpacing: '0.04em',
              }}
            >
              {meta.strategy}
            </span>
          )}
          {meta?.period && (
            <span
              style={{
                fontSize: 10,
                color: muteColor,
                padding: '2px 8px',
                borderRadius: 999,
                border: `1px solid ${tagBorder}`,
                letterSpacing: '0.04em',
              }}
            >
              {meta.period === '短'
                ? '短線'
                : meta.period === '中'
                ? '中線'
                : meta.period === '中長'
                ? '中長'
                : meta.period === '短中'
                ? '短中'
                : '長線'}
            </span>
          )}
        </div>
      )}

      {/* 4. Footer — 資訊密度（永遠存在） */}
      <div
        style={{
          paddingTop: 10,
          marginTop: 6,
          borderTop: `1px solid ${
            isInk ? 'rgba(239,237,232,0.14)' : HOLDINGS_TOKENS.hair
          }`,
          fontSize: HOLDINGS_TOKENS.fontFootnote,
          color: muteColor,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '0.04em',
          display: 'flex',
          justifyContent: 'space-between',
          gap: 8,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        <span>
          {Number(holding?.qty ?? 0).toLocaleString()}
          {holding?.unit || '股'} · 成本 {holding?.cost ?? '—'}
        </span>
        <span>市值 {fmt(value)}</span>
      </div>
    </button>
  );
}
