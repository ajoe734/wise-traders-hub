// @ts-nocheck
/**
 * HoldingCardReturn — 第 2 層：大字 ROI（%）＋ 附屬損益數值。
 * 保留 `.wb-roi` class 給 CSS clamp 與截圖回歸偵測。
 */
import { memo } from 'react';

function HoldingCardReturnImpl({
  pctVal,
  pnlVal,
  pnlColor,
  pnlWeight,
  pnlArrow,
  subColor,
  variant = 'normal',
}) {
  const isFeature = variant === 'ink';
  const fontSize = isFeature
    ? 'clamp(40px, 6vw + 12px, 64px)'
    : 'clamp(36px, 4.5vw + 10px, 52px)';
  const letterSpacing = isFeature ? '-0.04em' : '-0.035em';
  const gap = isFeature ? 6 : 5;
  const rowGap = isFeature ? 14 : 10;
  const marginTop = 8;
  const marginBottom = isFeature ? 10 : 8;

  return (
    <div aria-hidden="true" style={{
      display: 'flex', alignItems: 'baseline', gap: rowGap,
      marginTop, marginBottom,
    }}>
      <span
        className="wb-roi"
        style={{
          fontSize, fontWeight: pnlWeight, color: pnlColor,
          letterSpacing, lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
          display: 'inline-flex', alignItems: 'baseline', gap,
        }}
      >
        {pnlArrow && <span style={{ fontSize: '0.40em', opacity: 0.7, fontWeight: 400 }}>{pnlArrow}</span>}
        <span>
          {pctVal >= 0 ? '+' : ''}{pctVal.toFixed(2)}
          <span style={{
            fontSize: '0.55em', marginLeft: 3, opacity: 0.6,
            fontWeight: 500, verticalAlign: 'baseline',
          }}>%</span>
        </span>
      </span>
      {isFeature && (
        <span style={{
          fontSize: 13, color: subColor,
          fontVariantNumeric: 'tabular-nums', letterSpacing: '0.02em',
        }}>
          {pnlVal >= 0 ? '+' : ''}{pnlVal.toLocaleString()}
        </span>
      )}
    </div>
  );
}

export const HoldingCardReturn = memo(HoldingCardReturnImpl);
export default HoldingCardReturn;
