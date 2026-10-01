import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PriceSpectrum } from '@/checkup/components/freecheckup/PriceSpectrum';
import { MY_SCENARIO_LABEL } from '@/checkup/lib/valuationScenario';
import { readFileSync } from 'node:fs';

const WB = { ink: '#292520', inkSub: '#555', inkMute: '#666', inkLight: '#777', hair: '#ddd', accent: '#EC662D' };
const low = { status: 'lowConfidence', low: null, high: null, validCount: 3, basisCount: 3, asOf: '2026-10-01', rows: [] } as any;

describe('我的情境試算：不冒稱老師、與系統情境文字區分', () => {
  it('標籤不含老師／課程背書字樣', () => {
    expect(MY_SCENARIO_LABEL).toContain('我的情境試算（僅此裝置');
    expect(MY_SCENARIO_LABEL).toContain('非合理價');
    const src = readFileSync('src/checkup/components/freecheckup/CustomMultiplesEditor.tsx', 'utf8');
    expect(src).not.toMatch(/依課程|課程第|老師依|老師倍數|老師輸入/);
  });
  it('有試算時同一條價軸同時列出系統情境狀態與我的試算', () => {
    render(<PriceSpectrum WB={WB} price={7900} cost={2566} target={3429} band={low} customBand={{ low: 2009.57, high: 2730.73 }} />);
    expect(screen.getByTestId('holdings-price-axis-label-system').textContent).toContain('歷史情境倍數信心低，未畫區間');
    expect(screen.getByTestId('holdings-price-axis-label-custom').textContent).toContain(MY_SCENARIO_LABEL);
    expect(screen.getAllByTestId('custom-band')).toHaveLength(1);
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });
  it('清除後（customBand=null）試算帶與圖例一起消失', () => {
    render(<PriceSpectrum WB={WB} price={7900} cost={2566} target={3429} band={low} customBand={null} />);
    expect(screen.queryByTestId('custom-band')).toBeNull();
    expect(screen.queryByTestId('holdings-price-axis-label-custom')).toBeNull();
    expect(screen.getByTestId('holdings-price-axis-label-system')).toBeTruthy();
  });
});
