import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PositionTimelineView } from '@/pages/app/_journalDetail/PositionTimeline';
import type { PositionEvent } from '@/hooks/usePositionEvents';

const event = (overrides: Partial<PositionEvent> = {}): PositionEvent => ({
  id: 'e1', expert_id: 'x1', source_signal_id: 's1', symbol: '2330', instrument: '2330 台積電',
  action: 'buy', quantity_delta: 1000, quantity_after: 1000, quantity_unit: '張', trade_price: 1000,
  currency: 'TWD', asset_class: 'tw_stock', event_at: '2026-10-06T01:00:00Z', source_kind: 'live', ...overrides,
});

describe('PositionTimelineView', () => {
  it('顯示動作、成交價、數量差與變動後持股', () => {
    render(<PositionTimelineView events={[event()]} />);
    expect(screen.getByText('買進')).toBeVisible();
    expect(screen.getByText(/\+1 張/)).toBeVisible();
    expect(screen.getByText(/NT\$1000.00/)).toBeVisible();
    expect(screen.getByText(/持有 1 張/)).toBeVisible();
  });

  it('賣出顯示負數且缺價不推算', () => {
    render(<PositionTimelineView events={[event({ action: 'trim', quantity_delta: -500, quantity_after: 500, quantity_unit: '股', trade_price: null })]} />);
    expect(screen.getByText('減碼')).toBeVisible();
    expect(screen.getByText(/−500 股/)).toBeVisible();
    expect(screen.getByText(/成交價未提供/)).toBeVisible();
  });

  it('預設六筆並可展開', () => {
    render(<PositionTimelineView events={Array.from({ length: 8 }, (_, index) => event({ id: String(index), symbol: `00${index}`, instrument: `00${index} 股票${index}` }))} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: /查看全部 8 筆/ }));
    expect(screen.getAllByRole('listitem')).toHaveLength(8);
  });

  it('空值、載入與錯誤可重試', () => {
    const { rerender } = render(<PositionTimelineView events={[]} loading />);
    expect(screen.queryByText('尚無持股變化紀錄')).toBeNull();
    rerender(<PositionTimelineView events={[]} />);
    expect(screen.getByText('尚無持股變化紀錄。')).toBeVisible();
    const retry = vi.fn();
    rerender(<PositionTimelineView events={[]} error onRetry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});