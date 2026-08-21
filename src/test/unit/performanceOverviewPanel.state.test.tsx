/**
 * Regression: PerformanceOverviewPanel 的 onStateChange 為純附加行為。
 * - 不傳 onStateChange → 行為不變（不得丟錯）。
 * - loading / error / empty / ready 四狀態要如實上報。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverMock);

const perf = vi.hoisted(() => ({ value: { data: undefined as any, isLoading: true, isError: false } }));
const projection = vi.hoisted(() => ({ value: { state: 'ready', showNumbers: true, showReviewNotice: false, badge: null, note: null } }));

vi.mock('@/hooks/usePerformance', () => ({
  useExpertPerformance: () => perf.value,
  useExpertPerformanceRealtime: () => undefined,
}));
vi.mock('@/hooks/useProjectionStatus', () => ({
  useProjectionStatus: () => projection.value,
}));

import { PerformanceOverviewPanel } from '@/components/strategy/PerformanceOverviewPanel';

describe('PerformanceOverviewPanel onStateChange', () => {
  beforeEach(() => {
    cleanup();
    perf.value = { data: undefined, isLoading: true, isError: false };
    projection.value = { state: 'ready', showNumbers: true, showReviewNotice: false, badge: null, note: null };
  });

  it('renders without onStateChange (unchanged behaviour)', () => {
    expect(() => render(<PerformanceOverviewPanel expertId="e1" />)).not.toThrow();
  });

  it('reports loading', async () => {
    const spy = vi.fn();
    render(<PerformanceOverviewPanel expertId="e1" onStateChange={spy} />);
    await waitFor(() => expect(spy).toHaveBeenCalledWith('loading'));
  });

  it('reports error when the aggregate result is missing', async () => {
    perf.value = { data: null, isLoading: false, isError: false };
    const spy = vi.fn();
    const { getByText, queryByText } = render(<PerformanceOverviewPanel expertId="e1" onStateChange={spy} />);
    expect(getByText('資料暫時無法取得')).toBeTruthy();
    expect(queryByText('尚無可公開紀錄')).toBeNull();
    await waitFor(() => expect(spy).toHaveBeenCalledWith('error'));
  });

  it('reports error when a query fails', async () => {
    perf.value = { data: undefined, isLoading: false, isError: true };
    const spy = vi.fn();
    render(<PerformanceOverviewPanel expertId="e1" onStateChange={spy} />);
    await waitFor(() => expect(spy).toHaveBeenCalledWith('error'));
  });

  it('reports ready when rows exist', async () => {
    perf.value = { data: { total_trades: 1, starting_capital: 1000000, current_asset: 1100000, total_return_pct: 10 }, isLoading: false, isError: false };
    const spy = vi.fn();
    render(<PerformanceOverviewPanel expertId="e1" onStateChange={spy} />);
    await waitFor(() => expect(spy).toHaveBeenCalledWith('ready'));
  });

  it('reports error when the public projection is missing or unavailable', async () => {
    projection.value = { state: 'incomplete', showNumbers: false, showReviewNotice: true, badge: '資料檢核中', note: '該區間不納入績效' };
    perf.value = { data: null, isLoading: false, isError: false };
    const spy = vi.fn();
    const { getByText } = render(<PerformanceOverviewPanel expertId="e1" onStateChange={spy} />);
    expect(getByText('資料暫時無法取得')).toBeTruthy();
    await waitFor(() => expect(spy).toHaveBeenCalledWith('error'));
  });

  it('treats a zero-trade aggregate as empty, never ready', async () => {
    perf.value = { data: { total_trades: 0, starting_capital: 1000000, current_asset: 1000000, total_return_pct: 0 }, isLoading: false, isError: false };
    const spy = vi.fn();
    const { getByText, queryByText } = render(<PerformanceOverviewPanel expertId="e1" onStateChange={spy} />);
    expect(getByText('尚無可公開紀錄')).toBeTruthy();
    expect(queryByText('+0.00%')).toBeNull();
    await waitFor(() => expect(spy).toHaveBeenCalledWith('empty'));
  });
});
