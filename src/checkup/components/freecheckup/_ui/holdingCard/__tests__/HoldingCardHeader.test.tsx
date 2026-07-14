import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import HoldingCardHeader from '../HoldingCardHeader';

const baseProps = {
  h: { code: '2330', name: '台積電', qty: 1000, unit: '股' },
  meta: null,
  onReportMeta: undefined,
  variant: 'normal' as const,
  cardColor: '#000',
  muteColor: '#888',
  sparkData: [],
  sparkFailed: false,
  actionLabel: 'HOLD',
  pctVal: 5,
};

describe('HoldingCardHeader', () => {
  it('顯示代號、名稱、股數與 action 徽章', () => {
    render(<HoldingCardHeader {...baseProps} />);
    expect(screen.getByText('2330')).toBeInTheDocument();
    expect(screen.getByText('台積電')).toBeInTheDocument();
    expect(screen.getByText(/1,000/)).toBeInTheDocument();
    expect(screen.getByText('HOLD')).toBeInTheDocument();
  });

  it('EXIT / REVIEW / HOLD 徽章文字如實渲染', () => {
    const { rerender } = render(<HoldingCardHeader {...baseProps} actionLabel="EXIT" />);
    expect(screen.getByText('EXIT')).toBeInTheDocument();
    rerender(<HoldingCardHeader {...baseProps} actionLabel="REVIEW" />);
    expect(screen.getByText('REVIEW')).toBeInTheDocument();
  });

  it('sparkData >= 2 顯示 SVG sparkline，< 2 顯示 fallback 破折號', () => {
    const { container, rerender } = render(
      <HoldingCardHeader {...baseProps} sparkData={[1, 2, 3]} />
    );
    expect(container.querySelector('.wb-spark svg')).not.toBeNull();
    rerender(<HoldingCardHeader {...baseProps} sparkData={[]} />);
    expect(container.querySelector('.wb-spark svg')).toBeNull();
    expect(container.querySelector('.wb-spark')?.textContent).toBe('———');
  });

  it('sparkFailed=true 顯示 ~ 佔位並帶 title', () => {
    const { container } = render(
      <HoldingCardHeader {...baseProps} sparkData={[]} sparkFailed />
    );
    const spark = container.querySelector('.wb-spark');
    expect(spark?.textContent).toBe('~');
    expect(spark?.getAttribute('title')).toMatch(/歷史價尚未同步/);
  });

  it('industries + strategy 都渲染為 tag', () => {
    render(
      <HoldingCardHeader
        {...baseProps}
        meta={{ industries: ['半導體', 'AI'], strategy: '成長' }}
      />
    );
    expect(screen.getByText('半導體')).toBeInTheDocument();
    expect(screen.getByText('AI')).toBeInTheDocument();
    expect(screen.getByText('成長')).toBeInTheDocument();
  });

  it('meta.industry 單字串 fallback 也能渲染', () => {
    render(<HoldingCardHeader {...baseProps} meta={{ industry: '金融' }} />);
    expect(screen.getByText('金融')).toBeInTheDocument();
  });

  it('onReportMeta 提供時渲染回報按鈕，點擊觸發且 stopPropagation', () => {
    const onReportMeta = vi.fn();
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <HoldingCardHeader {...baseProps} onReportMeta={onReportMeta} />
      </div>
    );
    const btn = screen.getByRole('button', { name: /回報 2330 分類錯誤/ });
    fireEvent.click(btn);
    expect(onReportMeta).toHaveBeenCalledWith(baseProps.h);
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('沒有 qty 時不渲染 × N 股', () => {
    render(<HoldingCardHeader {...baseProps} h={{ code: 'X', name: 'Y' }} />);
    expect(screen.queryByText(/×/)).toBeNull();
  });
});
