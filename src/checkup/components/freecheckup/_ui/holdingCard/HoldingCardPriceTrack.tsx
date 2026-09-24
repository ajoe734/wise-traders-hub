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
import { isAwaitingMarketQuote } from '@/checkup/lib/quoteRequestGate';

/**
 * 卡片報價狀態，三選一，永不空白：
 *  - ready：已有市場報價
 *  - loading：只有成交價（剛新增）或尚無價格且沒有錯誤
 *  - none：取價失敗／查無報價
 */
export function holdingQuoteStatus(h: any): 'ready' | 'loading' | 'none' {
  const hasPrice = Number(h?.price) > 0;
  if (h?.priceError) return 'none';
  if (!hasPrice || isAwaitingMarketQuote(h)) return 'loading';
  return 'ready';
}

function HoldingCardPriceTrackImpl({
  h,
  meta: _meta, // eslint-disable-line no-unused-vars
  dec: _dec,   // eslint-disable-line no-unused-vars
  subColor: _subColor, // eslint-disable-line no-unused-vars
  muteColor: _muteColor, // eslint-disable-line no-unused-vars
  variant = 'normal',
}) {
  const isFeature = variant === 'ink';
  const wrapStyle = useMemo(() => ({
    marginBottom: isFeature ? 10 : 8,
  }), [isFeature]);

  const status = holdingQuoteStatus(h);
  const priceOk = Number(h.price) > 0 && Number(h.cost) > 0;
  return (
    <div className="wb-price-track" style={wrapStyle}>
      {priceOk && <PriceTrack cost={Number(h.cost)} now={Number(h.price)} />}
      {status !== 'ready' && (
        <div
          data-testid="card-quote-status"
          data-quote-status={status}
          role="status"
          className="cm-num"
          style={{ fontSize: 10, letterSpacing: '0.10em', color: 'var(--cm-ink-mute)', textAlign: 'right', marginTop: priceOk ? 2 : 0 }}
        >
          {status === 'loading' ? '報價載入中…' : '暫無報價'}
        </div>
      )}
    </div>
  );
}

export const HoldingCardPriceTrack = memo(HoldingCardPriceTrackImpl);
HoldingCardPriceTrack.displayName = 'HoldingCardPriceTrack';
export default HoldingCardPriceTrack;
