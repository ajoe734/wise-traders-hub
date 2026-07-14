// @ts-nocheck
/**
 * HoldingCardFooter — 第 4 層：TODAY | VALUE 兩欄底部帶。
 * 保留 `.wb-bottom` / `.wb-bottom-val` class 給 CSS clamp 與截圖回歸偵測。
 */
import { memo } from 'react';
import { WB } from '@/pages/_freeCheckup/constants.jsx';
import { alpha } from '@/checkup/theme.js';

// 對齊後端 daily-performance / _shared/stockPriceWaterfall.ts 的取價順序
const SRC_LABEL = {
  screenshot: '截圖',
  live: '即時',
  high: '最高',
  ask: '賣一',
  yclose: '昨收',
  demo: 'DEMO',
  regularMarketPrice: '收盤',
  previousClose: '昨收',
  chartClose: '已收K',
  twse: 'TWSE',
  yahoo: 'Yahoo',
};

function HoldingCardFooterImpl({
  h,
  tp,
  upside,
  hasToday,
  todayPnlNum,
  todayPctNum,
  variant = 'normal',
  subColor,
  muteColor,
  hairColor,
  lossColor,
}) {
  const isInk = variant === 'ink';
  const isFeature = isInk;

  const srcLabel = h.priceSource ? (SRC_LABEL[h.priceSource] || h.priceSource) : null;
  const srcTitle = h.priceError
    ? `報價問題：${h.priceError}`
    : [
        srcLabel ? `來源：${srcLabel}（${h.priceSource}）` : '尚未同步即時報價',
        h.priceUpdatedAt
          ? `更新於 ${new Date(h.priceUpdatedAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`
          : null,
        h.yesterday != null ? `昨收 ${Number(h.yesterday).toFixed(2)}` : null,
        Number.isFinite(Number(h.price)) ? `現價 ${Number(h.price).toFixed(2)}` : null,
      ].filter(Boolean).join('　');

  const srcBadgeBg = isFeature
    ? (h.priceSource === 'live' ? alpha(WB.accent, '30') : 'rgba(244,241,236,0.10)')
    : (h.priceSource === 'live'
        ? alpha(WB.accent, '22')
        : h.priceSource === 'screenshot'
          ? alpha(muteColor, '18')
          : alpha(lossColor, '22'));
  const srcBadgeColor = isFeature
    ? (h.priceSource === 'live' ? WB.accent : 'rgba(244,241,236,0.85)')
    : (h.priceSource === 'live' ? WB.accent : subColor);
  const srcBadgeOpacity = isFeature ? 0.9 : 0.85;

  const errBadgeBg = isFeature ? 'rgba(244,241,236,0.12)' : alpha(lossColor, '22');
  const errBadgeColor = isFeature ? 'rgba(244,241,236,0.65)' : lossColor;

  return (
    <div
      className="wb-bottom"
      style={{
        paddingTop: isFeature ? 12 : 10, marginTop: 8,
        borderTop: `1px solid ${hairColor}`,
        display: 'grid',
        gridTemplateColumns: 'minmax(0,1fr) 1px minmax(0,1fr)',
        gridTemplateRows: 'auto auto',
        columnGap: isFeature ? 16 : 12, rowGap: 2,
        alignItems: 'baseline',
        fontSize: 10, color: muteColor, fontWeight: 400,
        fontVariantNumeric: 'tabular-nums', letterSpacing: '0.06em',
      }}
    >
      <span style={{
        gridColumn: '1', gridRow: '1', fontSize: 9, color: muteColor,
        letterSpacing: '0.16em', opacity: 0.7, lineHeight: 1,
      }}>TODAY</span>
      <span style={{
        gridColumn: '3', gridRow: '1', display: 'flex', alignItems: 'center',
        gap: 6, fontSize: 9, color: muteColor,
        letterSpacing: '0.16em', opacity: 0.7, lineHeight: 1,
      }}>
        <span>VALUE</span>
        {srcLabel && (
          <span title={srcTitle} style={{
            fontSize: 8, letterSpacing: '0.06em', padding: '1px 5px', borderRadius: 2,
            background: srcBadgeBg, color: srcBadgeColor,
            opacity: srcBadgeOpacity, fontWeight: 500,
          }}>{srcLabel}</span>
        )}
        {h.priceError && !srcLabel && (
          <span title={h.priceError} style={{
            fontSize: 8, padding: '1px 5px', borderRadius: 2,
            background: errBadgeBg, color: errBadgeColor,
          }}>失敗</span>
        )}
      </span>
      <div style={{
        gridColumn: '2', gridRow: '1 / span 2',
        background: hairColor, width: 1, height: '100%',
      }} />
      <span
        className="wb-bottom-val"
        style={{
          gridColumn: '1', gridRow: '2',
          fontSize: 'clamp(10.5px, 0.9vw + 8px, 12px)',
          color: subColor, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2,
        }}
      >
        {hasToday ? (
          <>
            {todayPnlNum != null ? `${todayPnlNum >= 0 ? '+' : ''}${todayPnlNum.toLocaleString()}` : '—'}
            {todayPctNum != null && (
              <span style={{ marginLeft: 6, color: muteColor }}>
                {todayPctNum >= 0 ? '+' : ''}{todayPctNum.toFixed(2)}%
              </span>
            )}
          </>
        ) : (
          <span style={{ color: muteColor }}>—</span>
        )}
      </span>
      <span
        className="wb-bottom-val"
        style={{
          gridColumn: '3', gridRow: '2',
          fontSize: 'clamp(10.5px, 0.9vw + 8px, 12px)',
          color: subColor, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2,
        }}
      >
        {h.value?.toLocaleString() || '—'}
        {isFeature && tp && upside != null && (
          <span style={{ marginLeft: 6, color: muteColor }}>
            TGT {upside >= 0 ? '+' : ''}{upside.toFixed(1)}%
          </span>
        )}
      </span>
    </div>
  );
}

export const HoldingCardFooter = memo(HoldingCardFooterImpl);
export default HoldingCardFooter;
