// @ts-nocheck
/**
 * HoldingCardReturn — 第 2 層：大字 ROI（%）＋ ±40% 尺規報酬條 ＋ 附屬損益數值。
 * 保留 `.wb-roi` class 給 CSS clamp 與截圖回歸偵測。
 * Handoff §3.4 步驟 2：8px 橫條軌、共用 ±40% 尺規、正 accent／負 loss-bar、破表 ▸。
 *
 * 效能：
 *  - variant 決定的排版常數 (`variantStyle`) 以 `useMemo([isFeature])` 快取。
 *  - ROI 內層字元樣式為模組級凍結物件 (`ROI_ARROW_STYLE`/`ROI_PCT_STYLE`)，
 *    避免每次 render 產生新引用，DOM diff 更輕。
 */
import { memo, useMemo } from 'react';
import ReturnBar from '../ReturnBar';

const ROI_ARROW_STYLE = Object.freeze({ fontSize: '0.40em', opacity: 0.7, fontWeight: 400 });
const ROI_PCT_STYLE = Object.freeze({
  fontSize: '0.55em', marginLeft: 3, opacity: 0.6,
  fontWeight: 500, verticalAlign: 'baseline',
});

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

  const variantStyle = useMemo(() => ({
    fontSize: isFeature
      ? 'clamp(40px, 6vw + 12px, 64px)'
      : 'clamp(36px, 4.5vw + 10px, 52px)',
    letterSpacing: isFeature ? '-0.04em' : '-0.035em',
    gap: isFeature ? 6 : 5,
    rowGap: isFeature ? 14 : 10,
    marginTop: 8,
    marginBottom: isFeature ? 10 : 8,
  }), [isFeature]);

  const rowStyle = useMemo(() => ({
    display: 'flex', alignItems: 'baseline',
    gap: variantStyle.rowGap,
    marginTop: variantStyle.marginTop,
    marginBottom: variantStyle.marginBottom,
  }), [variantStyle]);

  const roiStyle = useMemo(() => ({
    fontSize: variantStyle.fontSize,
    fontWeight: pnlWeight,
    color: pnlColor,
    letterSpacing: variantStyle.letterSpacing,
    lineHeight: 1,
    fontVariantNumeric: 'tabular-nums',
    display: 'inline-flex',
    alignItems: 'baseline',
    gap: variantStyle.gap,
  }), [variantStyle, pnlWeight, pnlColor]);

  const pnlSubStyle = useMemo(() => ({
    fontSize: 13, color: subColor,
    fontVariantNumeric: 'tabular-nums', letterSpacing: '0.02em',
  }), [subColor]);

  return (
    <div aria-hidden="true" style={rowStyle}>
      <span className="wb-roi" style={roiStyle}>
        {pnlArrow && <span style={ROI_ARROW_STYLE}>{pnlArrow}</span>}
        <span>
          {pctVal >= 0 ? '+' : ''}{pctVal.toFixed(2)}
          <span style={ROI_PCT_STYLE}>%</span>
        </span>
      </span>
      {isFeature && (
        <span style={pnlSubStyle}>
          {pnlVal >= 0 ? '+' : ''}{pnlVal.toLocaleString()}
        </span>
      )}
      <ReturnBar pct={pctVal} scale={40} className="wb-return-bar" />
    </div>
  );
}

export const HoldingCardReturn = memo(HoldingCardReturnImpl);
HoldingCardReturn.displayName = 'HoldingCardReturn';
export default HoldingCardReturn;
