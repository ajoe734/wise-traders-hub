import { useMemo, type CSSProperties } from 'react';
import { MY_SCENARIO_LABEL, historyReferenceBands, SCENARIO_LABELS, type ValuationScenario } from '@/checkup/lib/valuationScenario';

/** 歷史參考帶的共同前綴：低信心、非合理價，和系統情境、我的試算以文字直接區分。 */
export const REFERENCE_LABEL = '歷史估值參考（低信心，非合理價）';

type Marker = { key: 'cost' | 'target' | 'price'; name: string; value: number; x: number };
type Palette = { ink: string; inkSub: string; inkMute: string; inkLight: string; hair: string; accent: string; surface?: string };

const money = (value: number) => `NT$${value.toLocaleString('zh-TW', { maximumFractionDigits: 2 })}`;
const valid = (value: number | null | undefined): value is number =>
  value != null && Number.isFinite(value) && value > 0;

/** Single continuous TWD scale. The percentage is never clamped per marker or band. */
export function priceSpectrumGeometry(
  values: { price?: number | null; cost?: number | null; target?: number | null },
  band?: ValuationScenario | null,
  customBand?: { low: number | null; high: number | null } | null,
) {
  const consensus = (band?.status === 'consensus' || band?.status === 'historical') && valid(band.low) && valid(band.high)
    ? { low: band.low, high: band.high, kind: band.status } : null;
  const custom = customBand && valid(customBand.low) && valid(customBand.high) && customBand.high > customBand.low
    ? { low: customBand.low, high: customBand.high } : null;
  const refs = historyReferenceBands(band).filter((r) => valid(r.low) && valid(r.high));
  const points = [values.cost, values.target, values.price, consensus?.low, consensus?.high, custom?.low, custom?.high, ...refs.flatMap((r) => [r.low, r.high])].filter(valid);
  if (!points.length) return null;
  const smallest = Math.min(...points);
  const largest = Math.max(...points);
  const padding = smallest === largest ? Math.max(smallest * 0.05, 1) : 0;
  const min = Math.max(0, smallest * 0.95 - padding);
  const max = largest * 1.05 + padding;
  const mapX = (value: number) => ((value - min) / (max - min)) * 100;
  return { min, max, mapX, consensus, custom, refs };
}

function systemLabel(consensus: { low: number; high: number; kind: string } | null, band?: ValuationScenario | null): string {
  if (consensus) return `${consensus.kind === 'consensus' ? '同業三尺共同情境（非保證）' : '歷史情境參考（非合理價）'} ${money(consensus.low)}–${money(consensus.high)}`;
  if (band?.status === 'lowConfidence') return '歷史情境倍數信心低，未畫區間';
  if (band?.status === 'divergent') return '方法分歧，未畫區間';
  if (band?.status === 'insufficient' && (band.basisCount ?? 0) >= 3) return '倍數依據不足，未畫區間';
  return '資料不足，未畫區間';
}

export function PriceSpectrum({ WB, price, cost, target, band, customBand = null }: {
  WB: Palette;
  price?: number | null;
  cost?: number | null;
  target?: number | null;
  band?: ValuationScenario | null;
  customBand?: { low: number | null; high: number | null } | null;
}) {
  const geometry = useMemo(() => priceSpectrumGeometry({ price, cost, target }, band, customBand), [price, cost, target, band, customBand]);
  if (!geometry) return null;
  const { min, max, mapX, consensus, custom, refs } = geometry;
  const markers: Marker[] = ([
    { key: 'cost', name: '成本', value: cost },
    { key: 'target', name: '目標', value: target },
    { key: 'price', name: '現價', value: price },
  ] as const).filter((m) => valid(m.value)).map((m) => ({ ...m, value: Number(m.value), x: mapX(Number(m.value)) })) as Marker[];
  const description = [
    '新台幣等比例價格線',
    ...markers.map((m) => `${m.name} ${money(m.value)}`),
     systemLabel(consensus, band),
     ...refs.map((r) => `${REFERENCE_LABEL} ${SCENARIO_LABELS[r.key]} ${money(r.low)} 至 ${money(r.high)}`),
     ...(custom ? [`${MY_SCENARIO_LABEL} ${money(custom.low)} 至 ${money(custom.high)}`] : []),
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
          {consensus && <>
            <line data-testid="valuation-band" data-kind={consensus.kind} data-low={consensus.low} data-high={consensus.high}
              x1={mapX(consensus.low)} x2={mapX(consensus.high)} y1="40" y2="40"
              className={`price-spectrum-band price-spectrum-fade${consensus.kind === 'historical' ? ' price-spectrum-band--historical' : ''}`} />
            {[consensus.low, consensus.high].map((v, index) => (
              <line key={index} x1={mapX(v)} x2={mapX(v)} y1="31" y2="49"
                className="price-spectrum-band-end price-spectrum-fade" />
            ))}
          </>}
          {refs.map((r, i) => {
            const y = 8 + i * 7;
            const x1 = mapX(r.low); const x2 = Math.max(mapX(r.high), x1 + 0.6);
            return <g key={r.key}>
              <line data-testid={`reference-band-${r.key}`} data-low={r.low} data-high={r.high}
                x1={x1} x2={x2} y1={y} y2={y} className="price-spectrum-band price-spectrum-band--reference price-spectrum-fade" />
              {[x1, x2].map((x, j) => <line key={j} x1={x} x2={x} y1={y - 2.5} y2={y + 2.5} className="price-spectrum-band-end price-spectrum-fade" />)}
            </g>;
          })}
          {custom && <>
            <line data-testid="custom-band" data-low={custom.low} data-high={custom.high}
              x1={mapX(custom.low)} x2={mapX(custom.high)} y1="66" y2="66" className="price-spectrum-band price-spectrum-band--custom price-spectrum-fade" />
            {[custom.low, custom.high].map((v, i) => <line key={`c${i}`} x1={mapX(v)} x2={mapX(v)} y1="61" y2="71" className="price-spectrum-band-end price-spectrum-fade" />)}
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
        <div className="price-spectrum-legend-row price-spectrum-legend-row--scenario" data-testid="holdings-price-axis-label-system">
          <span className="price-spectrum-legend-caption">系統估值情境</span>
          <strong>{systemLabel(consensus, band)}</strong>
        </div>
        {refs.length > 0 && <div className="price-spectrum-legend-row price-spectrum-legend-row--scenario" data-testid="holdings-price-axis-label-reference">
          <span className="price-spectrum-legend-caption">{REFERENCE_LABEL}・上方虛線</span>
          <strong>{refs.map((r) => `${SCENARIO_LABELS[r.key].split(' ')[0]} ${money(Math.round(r.low))}–${money(Math.round(r.high))}`).join('；')}</strong>
        </div>}
        {custom && <div className="price-spectrum-legend-row price-spectrum-legend-row--scenario" data-testid="holdings-price-axis-label-custom">
          <span className="price-spectrum-legend-caption">{MY_SCENARIO_LABEL}</span>
          <strong>{money(custom.low)}–{money(custom.high)}</strong>
        </div>}
      </div>
    </div>
  );
}