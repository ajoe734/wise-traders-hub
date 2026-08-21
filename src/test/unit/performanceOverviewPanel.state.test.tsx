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

const perf = vi.hoisted(() => ({ value: { data: undefined as any, isError: false } }));
const period = vi.hoisted(() => ({ value: { data: [] as any[], isLoading: true, isError: false } }));
const projection = vi.hoisted(() => ({ value: { state: 'ready', showNumbers: true, showReviewNotice: false, badge: null, note: null } }));

vi.mock('@/hooks/usePerformance', () => ({
  useExpertPerformance: () => perf.value,
  useExpertPerformanceRealtime: () => undefined,
}));
vi.mock('@/hooks/usePeriodPerformance', () => ({
  usePeriodPerformance: () => period.value,
}));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/hooks/useProjectionStatus', () => ({
  useProjectionStatus: () => projection.value,
}));

import { PerformanceOverviewPanel } from '@/components/strategy/PerformanceOverviewPanel';

describe('PerformanceOverviewPanel onStateChange', () => {
  beforeEach(() => {
    cleanup();
    perf.value = { data: undefined, isError: false };
    period.value = { data: [], isLoading: true, isError: false };
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

  it('reports empty when loaded with no rows', async () => {
    period.value = { data: [], isLoading: false, isError: false };
    const spy = vi.fn();
    render(<PerformanceOverviewPanel expertId="e1" onStateChange={spy} />);
    await waitFor(() => expect(spy).toHaveBeenCalledWith('empty'));
  });

  it('reports error when a query fails', async () => {
    period.value = { data: [], isLoading: false, isError: true };
    const spy = vi.fn();
    render(<PerformanceOverviewPanel expertId="e1" onStateChange={spy} />);
    await waitFor(() => expect(spy).toHaveBeenCalledWith('error'));
  });

  it('reports ready when rows exist', async () => {
    period.value = {
      data: [{ label: '2026', totalReturn: 0.1, equity: 1100000, sampleCount: 1 } as any],
      isLoading: false,
      isError: false,
    };
    const spy = vi.fn();
    render(<PerformanceOverviewPanel expertId="e1" onStateChange={spy} />);
    await waitFor(() => expect(spy).toHaveBeenCalledWith('ready'));
  });

  it('reports error when the public projection is missing or unavailable', async () => {
    projection.value = { state: 'incomplete', showNumbers: false, showReviewNotice: true, badge: '資料檢核中', note: '該區間不納入績效' };
    period.value = { data: [], isLoading: false, isError: false };
    const spy = vi.fn();
    const { getByText } = render(<PerformanceOverviewPanel expertId="e1" onStateChange={spy} />);
    expect(getByText('資料暫時無法取得')).toBeTruthy();
    await waitFor(() => expect(spy).toHaveBeenCalledWith('error'));
  });

  it('treats generated zero buckets with no samples as empty, never ready', async () => {
    period.value = {
      data: [{ label: '2026/08', returnPct: 0, sampleCount: 0 } as any],
      isLoading: false,
      isError: false,
    };
    const spy = vi.fn();
    const { getByText, queryByText } = render(<PerformanceOverviewPanel expertId="e1" onStateChange={spy} />);
    expect(getByText('尚無可公開紀錄')).toBeTruthy();
    expect(queryByText('+0.00%')).toBeNull();
    await waitFor(() => expect(spy).toHaveBeenCalledWith('empty'));
  });
});
