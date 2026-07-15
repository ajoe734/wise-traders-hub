// @ts-nocheck
/**
 * HoldingCardReturn — §3.4 定案：
 *   - 大字 ROI 從舊 40-64px → 18-22px（clamp），與抽屜大字明顯分層。
 *   - 正負以 `+` / `−` (U+2212) 表達；`↑/↓` 箭頭全刪。
 *   - 條軌交給 <ReturnBar>（±40% 尺規、破表 ▸）。
 *   - 附屬損益金額改為次要小字，不再限 feature card 才顯示。
 *
 * 保留 `.wb-roi` class 給 CSS clamp 與截圖回歸偵測。
 */
import { memo, useMemo } from 'react';
import ReturnBar from '../ReturnBar';

const ROI_PCT_STYLE = Object.freeze({
  fontSize: '0.7em', marginLeft: 2, opacity: 0.7,
  fontWeight: 500, verticalAlign: 'baseline',
});

function HoldingCardReturnImpl({
  pctVal,
  pnlVal,
  pnlColor,
  pnlWeight,
  subColor,
  variant: _variant, // eslint-disable-line no-unused-vars
}) {
  const rowStyle = useMemo(() => ({
    display: 'flex', alignItems: 'baseline',
    gap: 10,
    marginTop: 6,
    marginBottom: 6,
    flexWrap: 'wrap',
  }), []);

  const roiStyle = useMemo(() => ({
    fontSize: 'clamp(18px, 1.4vw + 12px, 22px)',
    fontWeight: pnlWeight,
    color: pnlColor,
    letterSpacing: '-0.01em',
    lineHeight: 1,
    fontVariantNumeric: 'tabular-nums',
    display: 'inline-flex',
    alignItems: 'baseline',
  }), [pnlWeight, pnlColor]);

  const pnlSubStyle = useMemo(() => ({
    fontSize: 11, color: subColor,
    fontVariantNumeric: 'tabular-nums', letterSpacing: '0.02em',
  }), [subColor]);

  // 正負號：+ / U+2212 (−)
  const sign = pctVal > 0 ? '+' : pctVal < 0 ? '\u2212' : '';
  const absPct = Math.abs(pctVal).toFixed(2);
  const pnlSign = pnlVal > 0 ? '+' : pnlVal < 0 ? '\u2212' : '';
  const pnlAbs = Math.abs(pnlVal).toLocaleString();

  return (
    <>
      <div aria-hidden="true" style={rowStyle}>
        <span className="wb-roi" style={roiStyle}>
          <span>
            {sign}{absPct}<span style={ROI_PCT_STYLE}>%</span>
          </span>
        </span>
        <span style={pnlSubStyle}>
          {pnlSign}{pnlAbs}
        </span>
      </div>
      <ReturnBar pct={pctVal} scale={40} className="wb-return-bar" />
    </>
  );
}

export const HoldingCardReturn = memo(HoldingCardReturnImpl);
HoldingCardReturn.displayName = 'HoldingCardReturn';
export default HoldingCardReturn;
