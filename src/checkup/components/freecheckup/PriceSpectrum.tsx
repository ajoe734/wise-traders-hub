import { useMemo, type CSSProperties } from 'react';
import { MY_SCENARIO_LABEL, type ScenarioKey } from '@/checkup/lib/valuationScenario';

type Marker = { key: 'cost' | 'target' | 'price'; name: string; value: number; x: number };
type Palette = { ink: string; inkSub: string; inkMute: string; inkLight: string; hair: string; accent: string; surface?: string };

const money = (value: number) => `NT$${value.toLocaleString('zh-TW', { maximumFractionDigits: 2 })}`;
const valid = (value: number | null | undefined): value is number =>
  value != null && Number.isFinite(value) && value > 0;

/** Single continuous TWD scale. The percentage is never clamped per marker or band. */
export function priceSpectrumGeometry(
  values: { price?: number | null; cost?: number | null; target?: number | null },
  customBand?: { low: number | null; high: number | null; key?: ScenarioKey | null } | null,
) {
  const custom = customBand && valid(customBand.low) && valid(customBand.high) && customBand.high > customBand.low
    ? { low: customBand.low, high: customBand.high, key: customBand.key ?? null } : null;
  const points = [values.cost, values.target, values.price, custom?.low, custom?.high].filter(valid);
  if (!points.length) return null;
  const smallest = Math.min(...points);
  const largest = Math.max(...points);
  const padding = smallest === largest ? Math.max(smallest * 0.05, 1) : 0;
  const min = Math.max(0, smallest * 0.95 - padding);
  const max = largest * 1.05 + padding;
  const mapX = (value: number) => ((value - min) / (max - min)) * 100;
  return { min, max, mapX, custom };
}

export function PriceSpectrum({ WB, price, cost, target, customBand = null }: {
  WB: Palette;
  price?: number | null;
  cost?: number | null;
  target?: number | null;
  customBand?: { low: number | null; high: number | null; key?: ScenarioKey | null } | null;
}) {
  const geometry = useMemo(() => priceSpectrumGeometry({ price, cost, target }, customBand), [price, cost, target, customBand]);
  if (!geometry) return null;
  const { min, max, mapX, custom } = geometry;
  const markers: Marker[] = ([
    { key: 'cost', name: '成本', value: cost },
    { key: 'target', name: '目標', value: target },
    { key: 'price', name: '現價', value: price },
  ] as const).filter((m) => valid(m.value)).map((m) => ({ ...m, value: Number(m.value), x: mapX(Number(m.value)) })) as Marker[];
  const description = [
    '新台幣等比例價格線',
    ...markers.map((m) => `${m.name} ${money(m.value)}`),
    ...(custom ? [`${MY_SCENARIO_LABEL}，${custom.key?.toUpperCase() || '單尺'}，${money(custom.low)} 至 ${money(custom.high)}`] : []),
  ].join('；');

  return (
    <div className="price-spectrum" data-testid="price-spectrum" aria-label={description}
      style={{ '--spectrum-ink': WB.ink, '--spectrum-sub': WB.inkSub, '--spectrum-mute': WB.inkMute,
        '--spectrum-light': WB.inkLight, '--spectrum-hair': WB.hair, '--spectrum-accent': WB.accent,
        '--spectrum-surface': WB.surface ?? '#fff' } as CSSProperties}>
      <div className="price-spectrum-track">
        <svg className="price-spectrum-rail" viewBox="0 0 100 80" preserveAspectRatio="none"
          role="img" aria-label={description}>
          <line x1="0" x2="100" y1="40" y2="40" className="price-spectrum-hair price-spectrum-fade" />
          <line x1="0" x2="0" y1="34" y2="46" className="price-spectrum-hair price-spectrum-fade" />
          <line x1="100" x2="100" y1="34" y2="46" className="price-spectrum-hair price-spectrum-fade" />
          {custom && <>
            <line data-testid="custom-band" data-low={custom.low} data-high={custom.high}
              data-key={custom.key ?? ''} x1={mapX(custom.low)} x2={mapX(custom.high)} y1="40" y2="40" className="price-spectrum-band price-spectrum-band--custom" />
            {[custom.low, custom.high].map((v, i) => <line key={`c${i}`} x1={mapX(v)} x2={mapX(v)} y1="32" y2="48" className="price-spectrum-band-end" />)}
          </>}
          {markers.map((m) => <line key={m.key} x1={m.x} x2={m.x} y1="40" y2={m.key === 'cost' ? '26' : m.key === 'target' ? '54' : '40'}
            className="price-spectrum-leader price-spectrum-fade" />)}
        </svg>
        {markers.map((m) => <span key={m.key} className={`price-spectrum-marker price-spectrum-marker--${m.key} price-spectrum-pop`}
          data-testid={m.key === 'price' ? 'holdings-price-axis-dot' : `price-spectrum-marker-${m.key}`}
          data-value={m.value} data-x={m.x} aria-hidden="true" style={{ left: `${m.x}%` }} />)}
      </div>
      <div className="price-spectrum-ends" aria-hidden="true"><span>{money(min)}</span><span>{money(max)}</span></div>
      <div className="price-spectrum-legend" data-testid="holdings-price-axis-compact">
        {[...markers].sort((a, b) => (a.key === 'price' ? -1 : b.key === 'price' ? 1 : a.key === 'cost' ? -1 : 1)).map((m) => <div key={m.key} className={`price-spectrum-legend-row price-spectrum-legend-row--${m.key}`}
          data-testid={`holdings-price-axis-label-${m.key}`} data-label-mode="stacked">
          <span className="price-spectrum-legend-caption"><span className={`price-spectrum-key price-spectrum-key--${m.key}`} aria-hidden="true" />{m.name}</span>
          <strong>{money(m.value)}</strong>
        </div>)}
        {custom && <div className="price-spectrum-legend-row price-spectrum-legend-row--scenario" data-testid="holdings-price-axis-label-custom">
          <span className="price-spectrum-legend-caption">{MY_SCENARIO_LABEL} · {custom.key?.toUpperCase() || '單尺'}</span>
          <strong>{money(custom.low)}–{money(custom.high)}</strong>
        </div>}
      </div>
    </div>
  );
}