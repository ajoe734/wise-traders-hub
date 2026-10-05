import { useMemo, type CSSProperties } from 'react';
import { MY_SCENARIO_LABEL, type ScenarioKey } from '@/checkup/lib/valuationScenario';

type Marker = { key: 'cost' | 'target' | 'price'; name: string; value: number; x: number };
type Palette = { ink: string; inkSub: string; inkMute: string; inkLight: string; hair: string; accent: string; surface?: string };

const money = (value: number) => `NT$${value.toLocaleString('zh-TW', { maximumFractionDigits: 2 })}`;
const valid = (value: number | null | undefined): value is number =>
  value != null && Number.isFinite(value) && value > 0;

type MarkerLayout = Marker & { lane: 'above' | 'below'; align: 'start' | 'center' | 'end' };

export function layoutSpectrumMarkers(markers: Marker[]): MarkerLayout[] {
  const sorted = [...markers].sort((a, b) => a.x - b.x);
  return sorted.map((marker, index) => {
    const previous = sorted[index - 1];
    const next = sorted[index + 1];
    const nearPrevious = !!previous && marker.x - previous.x < 28;
    const nearNext = !!next && next.x - marker.x < 28;
    const previousLane = index > 0 ? (nearPrevious ? (index % 2 === 0 ? 'above' : 'below') : null) : null;
    const lane = marker.key === 'price' && !nearPrevious && !nearNext
      ? 'above'
      : previousLane ?? (marker.key === 'target' ? 'below' : 'above');
    return {
      ...marker,
      lane,
      align: marker.x < 18 ? 'start' : marker.x > 82 ? 'end' : 'center',
    };
  });
}

/** Single continuous TWD scale. The percentage is never clamped per marker or band. */
export function priceSpectrumGeometry(
  values: { price?: number | null; cost?: number | null; target?: number | null },
  customBand?: { low: number | null; high: number | null; key?: ScenarioKey | null } | null,
  rulerBand?: { low: number | null; high: number | null; key?: ScenarioKey | null } | null,
) {
  const custom = customBand && valid(customBand.low) && valid(customBand.high) && customBand.high > customBand.low
    ? { low: customBand.low, high: customBand.high, key: customBand.key ?? null } : null;
  const ruler = rulerBand && valid(rulerBand.low) && valid(rulerBand.high) && rulerBand.high > rulerBand.low
    ? { low: rulerBand.low, high: rulerBand.high, key: rulerBand.key ?? null } : null;
  const points = [values.cost, values.target, values.price, custom?.low, custom?.high, ruler?.low, ruler?.high].filter(valid);
  if (!points.length) return null;
  const smallest = Math.min(...points);
  const largest = Math.max(...points);
  const padding = smallest === largest ? Math.max(smallest * 0.05, 1) : 0;
  const min = Math.max(0, smallest * 0.95 - padding);
  const max = largest * 1.05 + padding;
  const mapX = (value: number) => ((value - min) / (max - min)) * 100;
  return { min, max, mapX, custom, ruler };
}

export function PriceSpectrum({ WB, price, cost, target, customBand = null, rulerBand = null }: {
  WB: Palette;
  price?: number | null;
  cost?: number | null;
  target?: number | null;
  customBand?: { low: number | null; high: number | null; key?: ScenarioKey | null } | null;
  rulerBand?: { low: number | null; high: number | null; key?: ScenarioKey | null; label: string } | null;
}) {
  const geometry = useMemo(() => priceSpectrumGeometry({ price, cost, target }, customBand, rulerBand), [price, cost, target, customBand, rulerBand]);
  if (!geometry) return null;
  const { min, max, mapX, custom, ruler } = geometry;
  const markers: Marker[] = ([
    { key: 'cost', name: '成本', value: cost },
    { key: 'target', name: '目標', value: target },
    { key: 'price', name: '現價', value: price },
  ] as const).filter((m) => valid(m.value)).map((m) => ({ ...m, value: Number(m.value), x: mapX(Number(m.value)) })) as Marker[];
  const laidOutMarkers = layoutSpectrumMarkers(markers);
  const description = [
    '新台幣等比例價格線',
    ...markers.map((m) => `${m.name} ${money(m.value)}`),
    ...(custom ? [`${MY_SCENARIO_LABEL}，${custom.key?.toUpperCase() || '單尺'}，${money(custom.low)} 至 ${money(custom.high)}`] : []),
    ...(ruler && rulerBand ? [`${rulerBand.label}，${money(ruler.low)} 至 ${money(ruler.high)}`] : []),
  ].join('；');

  return (
    <div className="price-spectrum" data-testid="price-spectrum" aria-label={description}
      style={{ '--spectrum-ink': WB.ink, '--spectrum-sub': WB.inkSub, '--spectrum-mute': WB.inkMute,
        '--spectrum-light': WB.inkLight, '--spectrum-hair': WB.hair, '--spectrum-accent': WB.accent,
        '--spectrum-surface': WB.surface ?? '#fff' } as CSSProperties}>
      <div className="price-spectrum-track">
        <svg className="price-spectrum-rail" viewBox="0 0 100 176" preserveAspectRatio="none"
          role="img" aria-label={description}>
          <line x1="0" x2="100" y1="88" y2="88" className="price-spectrum-hair price-spectrum-fade" />
          <line x1="0" x2="0" y1="82" y2="94" className="price-spectrum-hair price-spectrum-fade" />
          <line x1="100" x2="100" y1="82" y2="94" className="price-spectrum-hair price-spectrum-fade" />
          {Array.from({ length: 21 }, (_, index) => {
            const x = index * 5;
            const major = index % 5 === 0;
            return <line key={`tick-${index}`} x1={x} x2={x} y1={major ? 81 : 84} y2={major ? 95 : 92}
              className={`price-spectrum-tick${major ? ' is-major' : ''}`} style={{ '--tick-index': index } as CSSProperties} />;
          })}
          {ruler && rulerBand && <>
            <line data-testid="ruler-band" data-low={ruler.low} data-high={ruler.high} data-key={ruler.key ?? ''}
              x1={mapX(ruler.low)} x2={mapX(ruler.high)} y1="88" y2="88" className="price-spectrum-band price-spectrum-band--ruler" />
            {[ruler.low, ruler.high].map((v, i) => <line key={`r${i}`} x1={mapX(v)} x2={mapX(v)} y1="81" y2="95" className="price-spectrum-band-end" />)}
          </>}
          {custom && <>
            <line data-testid="custom-band" data-low={custom.low} data-high={custom.high}
              data-key={custom.key ?? ''} x1={mapX(custom.low)} x2={mapX(custom.high)} y1="88" y2="88" className="price-spectrum-band price-spectrum-band--custom" />
            {[custom.low, custom.high].map((v, i) => <line key={`c${i}`} x1={mapX(v)} x2={mapX(v)} y1="81" y2="95" className="price-spectrum-band-end" />)}
          </>}
          {laidOutMarkers.map((m) => <line key={m.key} data-testid={`price-spectrum-leader-${m.key}`}
            x1={m.x} x2={m.x} y1="88" y2={m.lane === 'above' ? '50' : '126'}
            className={`price-spectrum-leader price-spectrum-leader--${m.key}`} />)}
        </svg>
        {laidOutMarkers.map((m) => <span key={`marker-${m.key}`} className={`price-spectrum-marker price-spectrum-marker--${m.key}`}
          data-testid={m.key === 'price' ? 'holdings-price-axis-dot' : `price-spectrum-marker-${m.key}`}
          data-value={m.value} data-x={m.x} aria-hidden="true" style={{ left: `${m.x}%` }} />)}
        {laidOutMarkers.map((m) => <div key={`label-${m.key}`}
          className={`price-spectrum-direct-label price-spectrum-direct-label--${m.key} price-spectrum-direct-label--${m.lane} price-spectrum-direct-label--${m.align}`}
          data-testid={`holdings-price-axis-label-${m.key}`} data-lane={m.lane} data-x={m.x}
          data-label-mode="float"
          style={{ left: `${m.x}%` }}>
          <span>{m.name}</span><strong>{money(m.value)}</strong>
        </div>)}
        {custom && (mapX(custom.high) - mapX(custom.low) < 24
          ? <div className="price-spectrum-scenario-range price-spectrum-scenario-range--compact"
              data-testid="holdings-price-axis-label-custom" style={{ left: `${(mapX(custom.low) + mapX(custom.high)) / 2}%` }}>
              我的 {custom.key?.toUpperCase() || '單尺'} 情境<strong>{money(custom.low)}–{money(custom.high)}</strong>
            </div>
          : <>
              <div className="price-spectrum-band-label price-spectrum-band-label--low" data-testid="custom-band-low" style={{ left: `${mapX(custom.low)}%` }}>{money(custom.low)}</div>
              <div className="price-spectrum-band-label price-spectrum-band-label--high" data-testid="custom-band-high" style={{ left: `${mapX(custom.high)}%` }}>{money(custom.high)}</div>
            </>)}
        {ruler && rulerBand && <div className="price-spectrum-scenario-range" data-testid="holdings-price-axis-label-ruler"
          style={{ left: `${(mapX(ruler.low) + mapX(ruler.high)) / 2}%` }}>
          {rulerBand.label}<strong>{money(ruler.low)}–{money(ruler.high)}</strong>
        </div>}
      </div>
      <div className="price-spectrum-ends" aria-hidden="true"><span>{money(min)}</span><span>{money(max)}</span></div>
      {!custom && !ruler && <div className="price-spectrum-scenario-prompt" data-testid="price-spectrum-scenario-prompt">選一把尺，試算你的情境價</div>}
    </div>
  );
}