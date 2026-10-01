import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { priceSpectrumGeometry } from './PriceSpectrum';
import { PriceSpectrum } from './PriceSpectrum';
import type { ValuationScenario } from '@/checkup/lib/valuationScenario';

const consensus = { status: 'consensus', low: 75, high: 100 } as ValuationScenario;
const WB = { ink: '#292520', inkSub: '#6b645c', inkMute: '#98918a', inkLight: '#b9b4ae', hair: '#ddd8d0', accent: '#b34832', surface: '#fff' };
const lowConfidence = (ranges: Array<[number, number]>) => ({
  status: 'lowConfidence', low: null, high: null, validCount: 3, basisCount: 3, asOf: '2026-10-01',
  rows: (['pe', 'pb', 'ps'] as const).map((key, i) => ({
    key, basisOk: true, basis: { value: 1, unit: 'TWD/share', period: '2026Q2', publishedAt: '2026-10-01', source: '公開財報', kind: 'reported', shareBasis: '同口徑股數' },
    multiples: { low: ranges[i][0], high: ranges[i][1], method: 'history', confidence: 'low', sampleSize: 5 },
    low: ranges[i][0], high: ranges[i][1], reason: null, samples: [],
  })),
}) as unknown as ValuationScenario;

describe('single continuous TWD price spectrum', () => {
  it('extreme gap remains proportional, never widens the scenario band', () => {
    const axis = priceSpectrumGeometry({ cost: 5100, target: 7100, price: 8385 }, consensus);
    expect(axis).not.toBeNull();
    if (!axis) return;
    const scale = (axis.mapX(100) - axis.mapX(75)) / (axis.mapX(8385) - axis.mapX(75));
    expect(scale).toBeCloseTo(25 / 8310, 10);
    expect(axis.mapX(5100)).toBeLessThan(axis.mapX(7100));
  });

  it('near prices retain their true differences even when markers overlap visually', () => {
    const axis = priceSpectrumGeometry({ cost: 100, target: 100.01, price: 100.02 }, consensus);
    expect(axis).not.toBeNull();
    if (!axis) return;
    expect(axis.mapX(100.01) - axis.mapX(100)).toBeCloseTo(
      axis.mapX(100.02) - axis.mapX(100.01), 10);
  });

  it.each(['divergent', 'insufficient'] as const)('%s never renders a false consensus interval', (status) => {
    const axis = priceSpectrumGeometry({ price: 200, cost: 170, target: 230 },
      { ...consensus, status });
    expect(axis?.consensus).toBeNull();
    expect(axis?.mapX(170)).toBeLessThan(axis?.mapX(230));
  });

  it('missing target and cost retain a finite, legible one-price scale', () => {
    const axis = priceSpectrumGeometry({ price: 100 });
    expect(axis?.mapX(100)).toBeGreaterThan(0);
    expect(axis?.mapX(100)).toBeLessThan(100);
    expect(priceSpectrumGeometry({ price: null, cost: null, target: null })).toBeNull();
  });

  it('狹窄交集維持真實比例，只畫一條綜合段並以上下引線讀值', () => {
    const band = lowConfidence([[100, 110], [104.98, 105.02], [102, 108]]);
    const { container } = render(<PriceSpectrum WB={WB} price={150} cost={90} target={160} band={band} />);
    const overlap = screen.getByTestId('reference-overlap-band');
    expect(overlap.getAttribute('data-low')).toBe('104.98');
    expect(overlap.getAttribute('data-high')).toBe('105.02');
    expect(Number(overlap.getAttribute('x2')) - Number(overlap.getAttribute('x1'))).toBeLessThan(0.1);
    expect(container.querySelectorAll('[data-testid^="reference-band-"]')).toHaveLength(0);
    expect(screen.getByTestId('reference-overlap-low').textContent).toBe('NT$104.98');
    expect(screen.getByTestId('reference-overlap-high').textContent).toBe('NT$105.02');
    const label = screen.getByTestId('holdings-price-axis-label-reference');
    expect(label.textContent).toContain('三尺重疊參考・低信心・非合理價');
    expect(label.textContent).toContain('NT$104.98–NT$105.02');
    expect(screen.queryByTestId('holdings-price-axis-label-system')).toBeNull();
  });

  it('三尺無交集時不畫綜合段，明示方法分歧', () => {
    const band = lowConfidence([[75, 100], [40, 60], [50, 75]]);
    render(<PriceSpectrum WB={WB} price={80} cost={65} target={90} band={band} />);
    expect(screen.queryByTestId('reference-overlap-band')).toBeNull();
    expect(screen.queryByTestId('holdings-price-axis-label-reference')).toBeNull();
    expect(screen.getByTestId('holdings-price-axis-label-system').textContent).toContain('方法分歧');
  });
});