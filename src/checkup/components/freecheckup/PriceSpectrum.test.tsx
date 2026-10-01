import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { layoutSpectrumMarkers, priceSpectrumGeometry, PriceSpectrum } from './PriceSpectrum';

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

  it('鄰近標記保留真實 x，標籤上下交錯而非移到三等分位置', () => {
    const axis = priceSpectrumGeometry({ cost: 2566.67, target: 3429, price: 7900 });
    expect(axis).not.toBeNull();
    if (!axis) return;
    const laidOut = layoutSpectrumMarkers([
      { key: 'cost', name: '成本', value: 2566.67, x: axis.mapX(2566.67) },
      { key: 'target', name: '目標', value: 3429, x: axis.mapX(3429) },
      { key: 'price', name: '現價', value: 7900, x: axis.mapX(7900) },
    ]);
    expect(laidOut.find((m) => m.key === 'cost')?.lane).not.toBe(laidOut.find((m) => m.key === 'target')?.lane);
    expect(laidOut.map((m) => m.x)).toEqual([
      axis.mapX(2566.67), axis.mapX(3429), axis.mapX(7900),
    ]);
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
    expect(label.textContent).toContain('我的 PE 情境');
    expect(label.textContent).toContain('NT$104.98–NT$105.02');
    expect(screen.getByTestId('price-spectrum').getAttribute('aria-label')).toContain('我的情境試算（僅此裝置');
  });

  it('沒有個人輸入時不畫任何估值段', () => {
    const { container } = render(<PriceSpectrum WB={WB} price={7900} cost={2566.67} target={3429} customBand={null} />);
    expect(screen.queryByTestId('reference-overlap-band')).toBeNull();
    expect(screen.queryByTestId('valuation-band')).toBeNull();
    expect(screen.queryByTestId('custom-band')).toBeNull();
    expect(screen.queryByTestId('holdings-price-axis-label-system')).toBeNull();
    expect(screen.getByTestId('price-spectrum-scenario-prompt').textContent).toBe('選一把尺，試算你的情境價');
    expect(container.querySelector('.price-spectrum-legend')).toBeNull();
    expect(screen.getByTestId('holdings-price-axis-label-price').textContent).toContain('現價NT$7,900');
    expect(screen.getByTestId('holdings-price-axis-label-cost').getAttribute('data-x')).toBe(
      screen.getByTestId('price-spectrum-marker-cost').getAttribute('data-x'));
    expect(screen.getByTestId('holdings-price-axis-label-target').getAttribute('data-x')).toBe(
      screen.getByTestId('price-spectrum-marker-target').getAttribute('data-x'));
  });
});