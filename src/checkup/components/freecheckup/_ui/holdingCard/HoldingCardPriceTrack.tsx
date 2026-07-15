// @ts-nocheck
/**
 * HoldingCardPriceTrack — 第 3 層：成本→現價文字帶 + 決策文字摘要。
 * 決策文字放在此層是刻意的：讓「價格如何走→為何持有」在視覺上緊鄰。
 *
 * 效能：
 *  - `decText` 以 `useMemo([dec?.actionText, meta?.strategy, isFeature])` 快取，
 *    避免每次現價 tick 都跑 `truncateAction` 正規表達式。
 *  - 成本 / 現價 顯示字串 (`costStr` / `priceStr`) 以 `useMemo` 快取。
 *  - 排版樣式物件依 `isFeature` / `subColor` 快取，維持 DOM diff 輕量。
 */
import { memo, useMemo } from 'react';

const truncateAction = (txt, limit) => {
  if (!txt || txt.length <= limit) return txt;
  const head = txt.slice(0, limit);
  const m = head.match(/^(.*[。、，；！？,.;!?])[^。、，；！？,.;!?]*$/);
  const cut = m ? m[1] : head.slice(0, limit - 2);
  return cut + '…';
};

function HoldingCardPriceTrackImpl({
  h,
  meta,
  dec,
  subColor,
  muteColor,
  variant = 'normal',
}) {
  const isFeature = variant === 'ink';

  const decText = useMemo(() => {
    const decLimit = isFeature ? 90 : 60;
    const decFallback = isFeature
      ? (meta?.strategy || '持續監控基本面與籌碼變動。')
      : (meta?.strategy ? meta.strategy.slice(0, 40) : '');
    return dec?.actionText ? truncateAction(dec.actionText, decLimit) : decFallback;
  }, [dec?.actionText, meta?.strategy, isFeature]);

  const costStr = useMemo(
    () => (h.cost != null ? Number(h.cost).toFixed(2) : '—'),
    [h.cost],
  );
  const priceStr = useMemo(
    () => (h.price != null ? Number(h.price).toFixed(2) : '—'),
    [h.price],
  );

  const rowStyle = useMemo(() => ({
    display: 'flex', alignItems: 'baseline', gap: 8,
    marginBottom: isFeature ? 10 : 8,
    fontSize: 11, color: subColor,
    fontVariantNumeric: 'tabular-nums', letterSpacing: '0.04em',
  }), [isFeature, subColor]);

  const labelStyle = useMemo(() => ({
    color: muteColor, letterSpacing: '0.12em', fontSize: 9, opacity: 0.8,
  }), [muteColor]);

  const arrowStyle = useMemo(
    () => ({ color: muteColor, opacity: 0.6 }),
    [muteColor],
  );

  const decWrapStyle = useMemo(() => ({
    flex: 1, display: 'flex',
    alignItems: isFeature ? 'center' : 'flex-end',
    gap: isFeature ? 18 : 14,
    minHeight: isFeature ? 48 : 40,
    paddingTop: isFeature ? 0 : 4,
  }), [isFeature]);

  const decTextStyle = useMemo(() => ({
    flex: 1, fontSize: 11, color: subColor,
    lineHeight: isFeature ? 1.7 : 1.65,
    letterSpacing: isFeature ? '0.01em' : 0,
  }), [isFeature, subColor]);

  return (
    <>
      <div style={rowStyle}>
        <span style={labelStyle}>成本</span>
        <span>{costStr}</span>
        <span style={arrowStyle}>→</span>
        <span style={labelStyle}>現價</span>
        <span>{priceStr}</span>
      </div>

      <div style={decWrapStyle}>
        <div style={decTextStyle}>{decText}</div>
      </div>
    </>
  );
}

export const HoldingCardPriceTrack = memo(HoldingCardPriceTrackImpl);
HoldingCardPriceTrack.displayName = 'HoldingCardPriceTrack';
export default HoldingCardPriceTrack;
