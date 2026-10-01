import { describe, expect, it } from 'vitest';
import { priceSpectrumGeometry } from './PriceSpectrum';
import type { ValuationScenario } from '@/checkup/lib/valuationScenario';

const consensus = { status: 'consensus', low: 75, high: 100 } as ValuationScenario;

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
});