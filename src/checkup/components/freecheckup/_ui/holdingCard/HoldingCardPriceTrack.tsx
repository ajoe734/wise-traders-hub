// @ts-nocheck
/**
 * HoldingCardPriceTrack — 第 3 層：Monocle 價格軌（1px 髮絲線 + 成本刻度 + 現價圓點）+
 * 「成本 X ｜ 現價 Y」10px 標籤級文字。
 *
 * Handoff §3.4 步驟 3：
 *   - 已改用 `_ui/PriceTrack.tsx`（.cm-pricetrack 憲法）。
 *   - **刪除** 決策/策略散文（`decText` fallback）— 移入抽屜 §4。
 *
 * DOM 契約：保留外層 div 讓 e2e 觀察容器；文字節點以 `成本 → 現價` 順序輸出，
 * 與舊 parity spec 一致（新 e2e 於本輪重寫）。
 */
import { memo, useMemo } from 'react';
import PriceTrack from '../PriceTrack';

function HoldingCardPriceTrackImpl({
  h,
  meta: _meta, // eslint-disable-line no-unused-vars
  dec: _dec,   // eslint-disable-line no-unused-vars
  subColor,
  muteColor,
  variant = 'normal',
}) {
  const isFeature = variant === 'ink';

  const costStr = useMemo(
    () => (h.cost != null ? Number(h.cost).toFixed(2) : '—'),
    [h.cost],
  );
  const priceStr = useMemo(
    () => (h.price != null ? Number(h.price).toFixed(2) : '—'),
    [h.price],
  );

  const wrapStyle = useMemo(() => ({
    marginBottom: isFeature ? 10 : 8,
  }), [isFeature]);

  const legendStyle = useMemo(() => ({
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 10,
    letterSpacing: '0.10em',
    color: muteColor,
    fontVariantNumeric: 'tabular-nums',
    marginTop: 4,
  }), [muteColor]);

  const labelStyle = useMemo(() => ({
    color: muteColor, opacity: 0.85,
  }), [muteColor]);

  const valStyle = useMemo(() => ({
    color: subColor, marginLeft: 4,
  }), [subColor]);

  return (
    <div className="wb-price-track" style={wrapStyle}>
      <PriceTrack cost={Number(h.cost)} now={Number(h.price)} />
      <div style={legendStyle}>
        <span>
          <span style={labelStyle}>成本</span>
          <span style={valStyle}>{costStr}</span>
        </span>
        <span>
          <span style={labelStyle}>現價</span>
          <span style={valStyle}>{priceStr}</span>
        </span>
      </div>
    </div>
  );
}

export const HoldingCardPriceTrack = memo(HoldingCardPriceTrackImpl);
HoldingCardPriceTrack.displayName = 'HoldingCardPriceTrack';
export default HoldingCardPriceTrack;
