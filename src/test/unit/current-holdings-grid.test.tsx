import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CurrentHoldingsGridView } from '@/pages/app/_journalDetail/CurrentHoldingsGrid';
import { resolveProjectionStatus } from '@/contracts/publicProjection';
import type { PerfRow } from '@/pages/_adminPerformance/types';

const ready = resolveProjectionStatus({ state: 'ready' });
const row = (overrides: Partial<PerfRow> = {}): PerfRow => ({
  id: '2330', instrument: '2330 台積電', symbol: '2330', name: '台積電',
  entry_price: 1000, current_price: 1050, pnl: 50000, pnl_percent: 5,
  quantity: 1, quantity_unit: '張', base_quantity: 1000, status: 'open',
  currency: 'TWD', asset_class: 'tw_stock', ...overrides,
});
const base = { currency: 'TWD' as const, assetClass: 'tw_stock' as const, projection: ready };

describe('CurrentHoldingsGridView', () => {
  it('顯示代號、名稱、張數、成本、現價、正損益與報酬率', () => {
    render(<CurrentHoldingsGridView {...base} positions={[row()]} />);
    expect(screen.getByText('2330')).toBeVisible();
    expect(screen.getByText('台積電')).toBeVisible();
    expect(screen.getByText('1 張')).toBeVisible();
    expect(screen.getByText('NT$1000.00')).toBeVisible();
    expect(screen.getByText('NT$1050.00')).toBeVisible();
    expect(screen.getByText('+NT$50,000')).toHaveClass('text-success');
    expect(screen.getByText('+5.00%')).toHaveClass('text-success');
  });

  it('負報酬使用下跌語意色，零值維持一般文字', () => {
    render(<CurrentHoldingsGridView {...base} positions={[
      row({ id: 'loss', symbol: '2492', name: '華新科', pnl: -2700, pnl_percent: -2.38 }),
      row({ id: 'flat', symbol: '0000', name: '零值', pnl: 0, pnl_percent: 0 }),
    ]} />);
    expect(screen.getByText('-NT$2,700')).toHaveClass('text-destructive');
    expect(screen.getByText('-2.38%')).toHaveClass('text-destructive');
    expect(screen.getByText('0.00%')).toHaveClass('text-foreground');
  });

  it('缺現價不推算，相關欄位顯示報價更新中', () => {
    render(<CurrentHoldingsGridView {...base} positions={[row({ current_price: null, pnl: null, pnl_percent: null })]} />);
    expect(screen.getAllByText('報價更新中')).toHaveLength(2);
    expect(screen.getByText('—')).toBeVisible();
    expect(screen.getByText('NT$1000.00')).toBeVisible();
  });

  it('預設三檔，可展開六檔並收合', () => {
    const positions = Array.from({ length: 6 }, (_, index) => row({ id: String(index), symbol: `000${index}`, name: `股票${index}` }));
    render(<CurrentHoldingsGridView {...base} positions={positions} />);
    expect(screen.getAllByTestId('journal-holding-card')).toHaveLength(3);
    const toggle = screen.getByTestId('journal-holdings-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(screen.getAllByTestId('journal-holding-card')).toHaveLength(6);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(screen.getAllByTestId('journal-holding-card')).toHaveLength(3);
  });

  it('載入中顯示三張穩定尺寸骨架', () => {
    render(<CurrentHoldingsGridView {...base} positions={[]} loading />);
    expect(screen.getByTestId('journal-holdings-loading').children).toHaveLength(3);
  });

  it('讀取失敗保留週記並可重試', () => {
    const retry = vi.fn();
    render(<CurrentHoldingsGridView {...base} positions={[]} error onRetry={retry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('週記內容仍可正常閱讀');
    fireEvent.click(screen.getByRole('button', { name: '重新讀取' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('零持股顯示精簡空狀態', () => {
    render(<CurrentHoldingsGridView {...base} positions={[]} />);
    expect(screen.getByTestId('journal-holdings-empty')).toHaveTextContent('目前沒有未平倉持股');
  });

  it.each(['manual_review', 'incomplete', 'withheld', 'error'] as const)('%s 投影狀態不渲染經濟數字', (state) => {
    render(<CurrentHoldingsGridView {...base} positions={[row()]} projection={resolveProjectionStatus({ state })} />);
    expect(screen.getByTestId('journal-holdings-review')).toHaveTextContent('資料檢核中');
    expect(screen.queryByText('NT$1000.00')).toBeNull();
  });

  it.each([
    ['股', 500], ['張', 1], ['口', 2], ['顆', 0.125], ['組', 3],
  ])('顯示 %s 單位', (unit, quantity) => {
    render(<CurrentHoldingsGridView {...base} positions={[row({ quantity, quantity_unit: unit })]} />);
    expect(screen.getByText(`${quantity.toLocaleString('zh-TW')} ${unit}`)).toBeVisible();
  });
});