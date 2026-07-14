// @ts-nocheck
/**
 * HoldingCardPriceTrack — 第 3 層：成本→現價文字帶 + 決策文字摘要。
 * 決策文字放在此層是刻意的：讓「價格如何走→為何持有」在視覺上緊鄰。
 */
import { memo } from 'react';

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
  const rowMb = isFeature ? 10 : 8;
  const decLimit = isFeature ? 90 : 60;
  const decFallback = isFeature
    ? (meta?.strategy || '持續監控基本面與籌碼變動。')
    : (meta?.strategy ? meta.strategy.slice(0, 40) : '');
  const decText = dec?.actionText ? truncateAction(dec.actionText, decLimit) : decFallback;
  const decMinH = isFeature ? 48 : 40;

  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 8,
        marginBottom: rowMb,
        fontSize: 11, color: subColor,
        fontVariantNumeric: 'tabular-nums', letterSpacing: '0.04em',
      }}>
        <span style={{ color: muteColor, letterSpacing: '0.12em', fontSize: 9, opacity: 0.8 }}>成本</span>
        <span>{h.cost != null ? Number(h.cost).toFixed(2) : '—'}</span>
        <span style={{ color: muteColor, opacity: 0.6 }}>→</span>
        <span style={{ color: muteColor, letterSpacing: '0.12em', fontSize: 9, opacity: 0.8 }}>現價</span>
        <span>{h.price != null ? Number(h.price).toFixed(2) : '—'}</span>
      </div>

      <div style={{
        flex: 1, display: 'flex',
        alignItems: isFeature ? 'center' : 'flex-end',
        gap: isFeature ? 18 : 14,
        minHeight: decMinH,
        paddingTop: isFeature ? 0 : 4,
      }}>
        <div style={{
          flex: 1, fontSize: 11, color: subColor,
          lineHeight: isFeature ? 1.7 : 1.65,
          letterSpacing: isFeature ? '0.01em' : 0,
        }}>{decText}</div>
      </div>
    </>
  );
}

export const HoldingCardPriceTrack = memo(HoldingCardPriceTrackImpl);
export default HoldingCardPriceTrack;
