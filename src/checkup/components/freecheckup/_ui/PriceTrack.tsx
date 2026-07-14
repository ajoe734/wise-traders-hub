import { memo } from 'react';

interface Props {
  cost: number;
  now: number;
  min?: number;
  max?: number;
  className?: string;
}

/**
 * Monocle 風價格軌：一條 1px 髮絲線 + 成本 1px 刻度 + 現價 8px 圓點（正 accent / 負 loss）。
 * min/max 未提供時，以 cost/now ±5% padding 自動推算。
 */
function PriceTrackImpl({ cost, now, min, max, className }: Props) {
  const c = Number(cost);
  const n = Number(now);
  if (!Number.isFinite(c) || !Number.isFinite(n) || c <= 0) return null;

  const lo = min ?? Math.min(c, n) * 0.95;
  const hi = max ?? Math.max(c, n) * 1.05;
  const range = Math.max(1e-6, hi - lo);
  const costPct = Math.max(0, Math.min(100, ((c - lo) / range) * 100));
  const nowPct = Math.max(0, Math.min(100, ((n - lo) / range) * 100));
  const isUp = n >= c;

  return (
    <div className={className}>
      <div className="cm-pricetrack">
        <span className="cm-pricetrack__cost" style={{ left: `${costPct}%` }} aria-hidden />
        <span
          className={`cm-pricetrack__now ${isUp ? 'cm-pricetrack__now--pos' : 'cm-pricetrack__now--neg'}`}
          style={{ left: `${nowPct}%` }}
          aria-hidden
        />
      </div>
      <div
        className="cm-num"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 10,
          letterSpacing: '0.10em',
          color: 'var(--cm-ink-mute)',
        }}
      >
        <span>成本 {c.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
        <span>現價 {n.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
      </div>
    </div>
  );
}

export const PriceTrack = memo(PriceTrackImpl);
export default PriceTrack;
