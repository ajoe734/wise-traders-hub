import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { ValuationPriceBand } from '@/checkup/lib/valuationRulers';

type Marker = { key: 'cost' | 'target' | 'price'; name: string; value: number; x: number };
type Palette = { ink: string; inkSub: string; inkMute: string; inkLight: string; hair: string; accent: string };

const money = (value: number) => `NT$${value.toLocaleString('zh-TW', { maximumFractionDigits: 2 })}`;
const valid = (value: number | null | undefined): value is number =>
  value != null && Number.isFinite(value) && value > 0;

/** Single continuous TWD scale. The percentage is never clamped per marker or band. */
export function priceSpectrumGeometry(
  values: { price?: number | null; cost?: number | null; target?: number | null },
  band?: ValuationPriceBand | null,
) {
  const consensus = band?.status === 'consensus' && valid(band.low) && valid(band.high)
    ? { low: band.low, high: band.high } : null;
  const points = [values.cost, values.target, values.price, consensus?.low, consensus?.high].filter(valid);
  if (!points.length) return null;
  const smallest = Math.min(...points);
  const largest = Math.max(...points);
  const padding = smallest === largest ? Math.max(smallest * 0.05, 1) : 0;
  const min = Math.max(0, smallest * 0.95 - padding);
  const max = largest * 1.05 + padding;
  const mapX = (value: number) => ((value - min) / (max - min)) * 100;
  return { min, max, mapX, consensus };
}

export function PriceSpectrum({ WB, price, cost, target, band }: {
  WB: Palette;
  price?: number | null;
  cost?: number | null;
  target?: number | null;
  band?: ValuationPriceBand | null;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => setWidth(track.getBoundingClientRect().width);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(track);
    return () => observer?.disconnect();
  }, []);

  const geometry = useMemo(() => priceSpectrumGeometry({ price, cost, target }, band), [price, cost, target, band]);
  if (!geometry) return null;
  const { min, max, mapX, consensus } = geometry;
  const markers: Marker[] = ([
    { key: 'cost', name: '成本', value: cost },
    { key: 'target', name: '目標', value: target },
    { key: 'price', name: '現價', value: price },
  ] as const).filter((m) => valid(m.value)).map((m) => ({ ...m, value: Number(m.value), x: mapX(Number(m.value)) })) as Marker[];
  // Direct labels only when each label has its own measured horizontal space.
  // Otherwise the same symbols and values appear in an external, non-overlapping legend.
  const sorted = [...markers].sort((a, b) => a.x - b.x);
  // Prefer the external legend for crowded labels. Distances account for two
  // full TWD tokens, not just the marker diameters; the direct lanes also
  // separate target from current price vertically.
  const direct = width >= 400 && sorted.every((m, i) =>
    m.x * width / 100 >= 95 && (100 - m.x) * width / 100 >= 95 &&
    (i === 0 || (m.x - sorted[i - 1].x) * width / 100 >= 160));
  const description = [
    '新台幣等比例價格線',
    ...markers.map((m) => `${m.name} ${money(m.value)}`),
    consensus ? `歷史估值參考區間 ${money(consensus.low)} 至 ${money(consensus.high)}` :
      band?.status === 'divergent' ? '三尺分歧，無共同區間' : '無可用歷史估值參考區間',
  ].join('；');

  return (
    <div className="price-spectrum" data-testid="price-spectrum" aria-label={description}
      style={{ '--spectrum-ink': WB.ink, '--spectrum-sub': WB.inkSub, '--spectrum-mute': WB.inkMute,
        '--spectrum-light': WB.inkLight, '--spectrum-hair': WB.hair, '--spectrum-accent': WB.accent } as CSSProperties}>
      <div ref={trackRef} className={`price-spectrum-track${direct ? ' price-spectrum-track--direct' : ''}`}>
        <svg className="price-spectrum-rail" viewBox="0 0 100 88" preserveAspectRatio="none"
          role="img" aria-label={description}>
          <line x1="0" x2="100" y1="54" y2="54" className="price-spectrum-hair price-spectrum-fade" />
          <line x1="0" x2="0" y1="48" y2="60" className="price-spectrum-hair price-spectrum-fade" />
          <line x1="100" x2="100" y1="48" y2="60" className="price-spectrum-hair price-spectrum-fade" />
          {consensus && <>
            <line data-testid="valuation-band" data-low={consensus.low} data-high={consensus.high}
              x1={mapX(consensus.low)} x2={mapX(consensus.high)} y1="54" y2="54"
              className="price-spectrum-band price-spectrum-fade" />
            {[consensus.low, consensus.high].map((v, index) => (
              <line key={index} x1={mapX(v)} x2={mapX(v)} y1="45" y2="63"
                className="price-spectrum-band-end price-spectrum-fade" />
            ))}
          </>}
          {markers.map((m) => <line key={m.key} x1={m.x} x2={m.x} y1="54" y2={m.key === 'cost' ? '42' : m.key === 'target' ? '66' : '54'}
            className="price-spectrum-leader price-spectrum-fade" />)}
        </svg>
        {markers.map((m) => <span key={m.key} className={`price-spectrum-marker price-spectrum-marker--${m.key} price-spectrum-pop`}
          data-testid={m.key === 'price' ? 'holdings-price-axis-dot' : `price-spectrum-marker-${m.key}`}
          data-value={m.value} data-x={m.x} aria-hidden="true" style={{ left: `${m.x}%` }} />)}
        {direct && markers.map((m) => <span key={m.key} className={`price-spectrum-direct price-spectrum-direct--${m.key} price-spectrum-fade`}
          data-testid={`holdings-price-axis-label-${m.key}`} data-label-mode="float"
          style={{ left: `${m.x}%` }}>{m.name} {money(m.value)}</span>)}
      </div>
      <div className="price-spectrum-ends" aria-hidden="true"><span>{money(min)}</span><span>{money(max)}</span></div>
      {!direct && <div className="price-spectrum-legend" data-testid="holdings-price-axis-compact">
        {markers.map((m) => <div key={m.key} className="price-spectrum-legend-row"
          data-testid={`holdings-price-axis-label-${m.key}`} data-label-mode="stacked">
          <span className={`price-spectrum-key price-spectrum-key--${m.key}`} aria-hidden="true" />
          <span>{m.name}</span><strong>{money(m.value)}</strong>
        </div>)}
      </div>}
    </div>
  );
}