import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { buildValuationScenario, type ScenarioRowInput } from '@/checkup/lib/valuationScenario';
import { buildValuationView } from '@/checkup/lib/valuationRulers';
import { ValuationRulersView } from './ValuationRulers';
import { PriceSpectrum } from './PriceSpectrum';

const WB = { ink: '#292520', inkSub: '#6b645c', inkMute: '#98918a', inkLight: '#b9b4ae', hair: '#ddd8d0', accent: '#b34832', surface: '#fff' };
const basis = (value: number) => ({ value, unit: 'TWD/share' as const, period: '2026 FY', publishedAt: '2026-09-20', source: '隔離算式 fixture', kind: 'reported' as const, shareBasis: '2026 加權平均股數' });
const multiples = (low: number, high: number) => ({ low, high, reason: '隔離算式理由', source: '隔離測試', period: '2026 FY', sampleSize: 3, peerComparability: '同產品與風險', cycle: '相近景氣', growth: '成長評估', earningsStability: '獲利評估', cash: '現金評估', debt: '負債評估', shareBasis: '2026 加權平均股數' });
const rows: ScenarioRowInput[] = [
  { key: 'pe', basis: basis(5), multiples: multiples(15, 20) },
  { key: 'pb', basis: basis(40), multiples: multiples(1, 1.5) },
  { key: 'ps', basis: basis(25), multiples: multiples(2, 3) },
];
const view = buildValuationView({ symbol: 'fixture', asOf: '2026-09-23', source: '隔離測試', pe: null, pb: null, dividendYield: null, industry: null, history: { pe: [], pb: [], dividendYield: [] }, peerScope: null, peerIndustry: null, peers: [], trend: [] });

describe('rendered PE/PB/PS scenario fixture', () => {
  it('three independent calculations are readable but divergent: no false band', () => {
    const scenario = buildValuationScenario('2026-09-23', rows);
    const { container } = render(<><ValuationRulersView WB={WB} view={view} band={scenario} defaultBasisOpen status="ready" error={null} stale={false} onRetry={() => {}} /><PriceSpectrum WB={WB} price={80} cost={65} target={90} band={scenario} /></>);
    expect(screen.getByTestId('valuation-basis-range-pe').textContent).toContain('NT$5 × 15–20 倍 = NT$75–NT$100');
    expect(screen.getByTestId('valuation-basis-range-pb').textContent).toContain('NT$40 × 1–1.5 倍 = NT$40–NT$60');
    expect(screen.getByTestId('valuation-basis-range-ps').textContent).toContain('NT$25 × 2–3 倍 = NT$50–NT$75');
    expect(screen.getByTestId('valuation-summary').textContent).toContain('暫無單一合理區間');
    expect(container.querySelector('[data-testid="valuation-band"]')).toBeNull();
    expect(container.querySelectorAll('[data-testid^="price-spectrum-marker-"]')).toHaveLength(2);
  });
  it('consensus fixture draws one TWD band at numeric x endpoints', () => {
    const scenario = buildValuationScenario('2026-09-23', [rows[0], { ...rows[1], multiples: multiples(2, 2.5) }, { ...rows[2], multiples: multiples(3, 4) }]);
    const { container } = render(<PriceSpectrum WB={WB} price={110} cost={60} target={120} band={scenario} />);
    const band = container.querySelector('[data-testid="valuation-band"]');
    expect(band?.getAttribute('data-low')).toBe('80');
    expect(band?.getAttribute('data-high')).toBe('100');
    expect(Number(band?.getAttribute('x1'))).toBeLessThan(Number(band?.getAttribute('x2')));
  });
});
