// @ts-nocheck
/**
 * HoldingCardFooter — 第 4 層：中文一行「今日 X ｜ 市值 Y」。
 *
 * Handoff §3.4 步驟 4：
 *   - 刪除 TODAY / VALUE 英文欄頭。
 *   - 刪除價格來源徽章（screenshot / 即時 / 昨收…）— 移入抽屜 title。
 *   - 刪除 TGT ±% — 屬決策書抽屜的目標價區。
 *   - 為避免資料流丟失，來源字串以 `data-price-src` / `title` 掛在 `.wb-bottom` 容器上，
 *     供下一輪抽屜對接消費；本層不再產生任何徽章 DOM。
 *
 * 保留 `.wb-bottom` / `.wb-bottom-val` class 讓卡片 RWD CSS 沿用。
 */
import { memo, useMemo } from 'react';
import { WB } from '@/pages/_freeCheckup/constants.jsx';
import { formatAge, formatClock } from '@/checkup/lib/freshness';

// 對齊 supabase/functions/_shared/stockPriceWaterfall.ts 的 label 映射，保留 data-price-src 以供抽屜使用
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
  tp: _tp,           // eslint-disable-line no-unused-vars
  upside: _upside,   // eslint-disable-line no-unused-vars
  hasToday,
  todayPnlNum,
  todayPctNum,
  variant = 'normal',
  subColor,
  muteColor,
  hairColor,
  lossColor,
}) {
  const isFeature = variant === 'ink';

  const srcLabel = h.priceSource ? (SRC_LABEL[h.priceSource] || h.priceSource) : null;
  const srcTitle = useMemo(() => {
    if (h.priceError) return `報價問題：${h.priceError}`;
    return [
      srcLabel ? `來源：${srcLabel}（${h.priceSource}）` : '尚未同步即時報價',
      h.priceTradeDate
        ? `收盤交易日 ${String(h.priceTradeDate).replace(/-/g, '/')}${h.priceState === 'pending' ? '（待確認）' : '（已確認）'}`
        : '尚無已確認收盤（不以盤中報價充當）',
      h.priceUpdatedAt
        ? `更新於 ${formatClock(new Date(h.priceUpdatedAt).getTime())}（${formatAge(Date.now() - new Date(h.priceUpdatedAt).getTime())}）`
        : null,
      h.yesterday != null ? `昨收 ${Number(h.yesterday).toFixed(2)}` : null,
      Number.isFinite(Number(h.price)) ? `現價 ${Number(h.price).toFixed(2)}` : null,
    ].filter(Boolean).join('　');
  }, [h.priceError, h.priceSource, h.priceTradeDate, h.priceState, h.priceUpdatedAt, h.yesterday, h.price, srcLabel]);

  // pnl 顏色：正 accent / 負 lossColor / 空 muteColor
  const todayPctColor = todayPctNum == null
    ? muteColor
    : (todayPctNum >= 0 ? WB.accent : lossColor);

  const containerStyle = useMemo(() => ({
    paddingTop: isFeature ? 12 : 10,
    marginTop: 'auto',
    borderTop: `1px solid ${hairColor}`,
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
    fontSize: 11,
    color: subColor,
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '0.02em',
    minWidth: 0,
    overflow: 'hidden',
    maxWidth: '100%',
  }), [isFeature, hairColor, subColor]);

  const labelStyle = useMemo(() => ({
    color: muteColor, marginRight: 6, letterSpacing: '0.06em',
  }), [muteColor]);

  const valCellStyle = useMemo(() => ({
    display: 'inline-block',
    verticalAlign: 'baseline',
    whiteSpace: 'nowrap',
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    fontSize: 'clamp(11px, 0.9vw + 8px, 13px)',
    color: subColor,
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1.2,
  }), [subColor]);

  const todayText = hasToday && todayPnlNum != null
    ? `${todayPnlNum >= 0 ? '+' : ''}${todayPnlNum.toLocaleString()}`
    : '—';
  const todayPctText = hasToday && todayPctNum != null
    ? `${todayPctNum >= 0 ? '+' : ''}${todayPctNum.toFixed(2)}%`
    : '';

  const valueStr = h.value?.toLocaleString() || '—';
  const valueMissing = valueStr === '—';

  return (
    <div
      className="wb-bottom"
      data-price-src={h.priceSource || ''}
      data-price-src-label={srcLabel || ''}
      data-price-trade-date={h.priceTradeDate || ''}
      data-price-state={h.priceState || (h.priceTradeDate ? 'confirmed' : 'unknown')}
      data-price-error={h.priceError || ''}
      title={srcTitle}
      style={containerStyle}
    >
      <span style={{ minWidth: 0, overflow: 'hidden' }}>
        <span style={labelStyle}>今日</span>
        <span className="wb-bottom-val" style={valCellStyle}>
          {todayText}
          {todayPctText && (
            <span style={{ marginLeft: 6, color: todayPctColor }}>{todayPctText}</span>
          )}
        </span>
      </span>
      <span aria-hidden="true" style={{
        color: muteColor, opacity: 0.5, fontSize: 10, flexShrink: 0,
      }}>｜</span>
      <span style={{ minWidth: 0, overflow: 'hidden', textAlign: 'right' }}>
        <span style={labelStyle}>市值</span>
        <span
          className="wb-bottom-val"
          style={valCellStyle}
          aria-label={valueMissing ? '無資料' : undefined}
        >{valueStr}</span>
      </span>
    </div>
  );
}


export const HoldingCardFooter = memo(HoldingCardFooterImpl);
HoldingCardFooter.displayName = 'HoldingCardFooter';
export default HoldingCardFooter;
