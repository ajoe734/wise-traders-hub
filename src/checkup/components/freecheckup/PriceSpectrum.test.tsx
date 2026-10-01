import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { priceSpectrumGeometry, PriceSpectrum } from './PriceSpectrum';

const WB = { ink: '#292520', inkSub: '#6b645c', inkMute: '#98918a', inkLight: '#b9b4ae', hair: '#ddd8d0', accent: '#b34832', surface: '#fff' };

describe('single continuous TWD price spectrum', () => {
  it('extreme gap remains proportional, never widens the personal scenario band', () => {
    const axis = priceSpectrumGeometry({ cost: 5100, target: 7100, price: 8385 }, { low: 75, high: 100, key: 'pe' });
    expect(axis).not.toBeNull();
    if (!axis) return;
    const scale = (axis.mapX(100) - axis.mapX(75)) / (axis.mapX(8385) - axis.mapX(75));
    expect(scale).toBeCloseTo(25 / 8310, 10);
    expect(axis.mapX(5100)).toBeLessThan(axis.mapX(7100));
  });

  it('near prices retain their true differences even when markers overlap visually', () => {
    const axis = priceSpectrumGeometry({ price: 100, cost: 100.01, target: 100.02 }, { low: 99.99, high: 100.03, key: 'pe' });
    expect(axis).not.toBeNull();
    if (!axis) return;
    expect(axis.mapX(100.01) - axis.mapX(100)).toBeCloseTo(axis.mapX(100.02) - axis.mapX(100.01), 10);
  });

  it('missing target and cost retain a finite, legible one-price scale', () => {
    const axis = priceSpectrumGeometry({ price: 100 });
    expect(axis?.mapX(100)).toBeGreaterThan(0);
    expect(axis?.mapX(100)).toBeLessThan(100);
    expect(priceSpectrumGeometry({ price: null, cost: null, target: null })).toBeNull();
  });

  it('單尺個人情境維持真實比例，不畫任何三尺交集或系統帶', () => {
    const { container } = render(<PriceSpectrum WB={WB} price={150} cost={90} target={160} customBand={{ low: 104.98, high: 105.02, key: 'pe' }} />);
    const custom = screen.getByTestId('custom-band');
    expect(custom.getAttribute('data-low')).toBe('104.98');
    expect(custom.getAttribute('data-high')).toBe('105.02');
    expect(custom.getAttribute('data-key')).toBe('pe');
    expect(Number(custom.getAttribute('x2')) - Number(custom.getAttribute('x1'))).toBeLessThan(0.1);
    expect(container.querySelector('[data-testid="reference-overlap-band"]')).toBeNull();
    expect(container.querySelector('[data-testid="valuation-band"]')).toBeNull();
    const label = screen.getByTestId('holdings-price-axis-label-custom');
    expect(label.textContent).toContain('我的情境試算（僅此裝置');
    expect(label.textContent).toContain('PE');
    expect(label.textContent).toContain('NT$104.98–NT$105.02');
  });

  it('沒有個人輸入時不畫任何估值段', () => {
    render(<PriceSpectrum WB={WB} price={80} cost={65} target={90} customBand={null} />);
    expect(screen.queryByTestId('reference-overlap-band')).toBeNull();
    expect(screen.queryByTestId('valuation-band')).toBeNull();
    expect(screen.queryByTestId('custom-band')).toBeNull();
    expect(screen.queryByTestId('holdings-price-axis-label-system')).toBeNull();
  });
});