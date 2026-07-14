import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import HoldingCardReturn from '../HoldingCardReturn';

const base = {
  pctVal: 12.3456,
  pnlVal: 12345,
  pnlColor: '#FF4D1F',
  pnlWeight: 500,
  pnlArrow: '↑',
  subColor: '#555',
  variant: 'normal' as const,
};

describe('HoldingCardReturn', () => {
  it('正數 ROI 帶 + 號、兩位小數、% 符號、↑ 箭頭', () => {
    const { container } = render(<HoldingCardReturn {...base} />);
    const roi = container.querySelector('.wb-roi');
    expect(roi).not.toBeNull();
    expect(roi?.textContent).toContain('↑');
    expect(roi?.textContent).toContain('+12.35');
    expect(roi?.textContent).toContain('%');
  });

  it('負數 ROI 無 + 號、顯示 ↓ 箭頭', () => {
    const { container } = render(
      <HoldingCardReturn {...base} pctVal={-8.2} pnlArrow="↓" />
    );
    const roi = container.querySelector('.wb-roi');
    expect(roi?.textContent).toContain('↓');
    expect(roi?.textContent).toContain('-8.20');
    expect(roi?.textContent).not.toContain('+-');
  });

  it('pctVal=0 無箭頭、無 + 號', () => {
    const { container } = render(
      <HoldingCardReturn {...base} pctVal={0} pnlArrow="" />
    );
    const roi = container.querySelector('.wb-roi');
    expect(roi?.textContent).not.toContain('↑');
    expect(roi?.textContent).not.toContain('↓');
    expect(roi?.textContent).toContain('+0.00');
  });

  it('normal variant 不渲染附屬損益，ink variant 才顯示', () => {
    const { rerender, container } = render(<HoldingCardReturn {...base} />);
    expect(container.textContent).not.toContain('12,345');
    rerender(<HoldingCardReturn {...base} variant="ink" />);
    expect(screen.getByText('+12,345')).toBeInTheDocument();
  });

  it('ink variant 負損益顯示無 + 號', () => {
    render(<HoldingCardReturn {...base} variant="ink" pnlVal={-9876} />);
    expect(screen.getByText('-9,876')).toBeInTheDocument();
  });
});
