import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import HoldingCardFooter from '../HoldingCardFooter';

const base = {
  h: { value: 123456, price: 100 },
  tp: null,
  upside: null,
  hasToday: false,
  todayPnlNum: null,
  todayPctNum: null,
  variant: 'normal' as const,
  subColor: '#333',
  muteColor: '#888',
  hairColor: '#eee',
  lossColor: '#8A857F',
};

describe('HoldingCardFooter', () => {
  it('渲染 TODAY / VALUE 標籤與 value 千分位', () => {
    render(<HoldingCardFooter {...base} />);
    expect(screen.getByText('TODAY')).toBeInTheDocument();
    expect(screen.getByText('VALUE')).toBeInTheDocument();
    expect(screen.getByText('123,456')).toBeInTheDocument();
  });

  it('hasToday=false 時 TODAY 欄顯示 —', () => {
    const { container } = render(<HoldingCardFooter {...base} />);
    const bottomVals = container.querySelectorAll('.wb-bottom-val');
    expect(bottomVals[0]?.textContent).toBe('—');
  });

  it('hasToday=true 顯示今日損益 + 百分比、正數帶 + 號', () => {
    render(
      <HoldingCardFooter
        {...base}
        hasToday
        todayPnlNum={1234}
        todayPctNum={2.345}
      />
    );
    expect(screen.getByText('+1,234')).toBeInTheDocument();
    expect(screen.getByText('+2.35%')).toBeInTheDocument();
  });

  it('負數今日損益無 + 號、負百分比正確', () => {
    render(
      <HoldingCardFooter
        {...base}
        hasToday
        todayPnlNum={-500}
        todayPctNum={-1.2}
      />
    );
    expect(screen.getByText('-500')).toBeInTheDocument();
    expect(screen.getByText('-1.20%')).toBeInTheDocument();
  });

  it('priceSource=live 顯示「即時」徽章', () => {
    render(
      <HoldingCardFooter
        {...base}
        h={{ ...base.h, priceSource: 'live' }}
      />
    );
    expect(screen.getByText('即時')).toBeInTheDocument();
  });

  it('priceSource=screenshot 顯示「截圖」徽章', () => {
    render(
      <HoldingCardFooter
        {...base}
        h={{ ...base.h, priceSource: 'screenshot' }}
      />
    );
    expect(screen.getByText('截圖')).toBeInTheDocument();
  });

  it('未知 priceSource 直接以原字串顯示', () => {
    render(
      <HoldingCardFooter
        {...base}
        h={{ ...base.h, priceSource: 'foobar' }}
      />
    );
    expect(screen.getByText('foobar')).toBeInTheDocument();
  });

  it('無 srcLabel 但有 priceError 顯示「失敗」徽章', () => {
    render(
      <HoldingCardFooter
        {...base}
        h={{ ...base.h, priceError: 'timeout' }}
      />
    );
    const badge = screen.getByText('失敗');
    expect(badge).toBeInTheDocument();
    expect(badge.getAttribute('title')).toBe('timeout');
  });

  it('normal variant 有 tp/upside 不渲染 TGT（僅 feature 顯示）', () => {
    const { container } = render(
      <HoldingCardFooter {...base} tp={150} upside={12.34} />
    );
    expect(container.textContent).not.toMatch(/TGT/);
  });

  it('ink variant + tp + upside 才顯示 TGT，正負符號正確', () => {
    const { container, rerender } = render(
      <HoldingCardFooter {...base} variant="ink" tp={150} upside={12.34} />
    );
    expect(container.textContent).toContain('TGT +12.3%');
    rerender(
      <HoldingCardFooter {...base} variant="ink" tp={80} upside={-8.7} />
    );
    expect(container.textContent).toContain('TGT -8.7%');
  });

  it('value 缺失時顯示 —', () => {
    const { container } = render(
      <HoldingCardFooter {...base} h={{ price: 100 }} />
    );
    const vals = container.querySelectorAll('.wb-bottom-val');
    expect(vals[1]?.textContent).toBe('—');
  });
});
