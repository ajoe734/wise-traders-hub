/**
 * Regression: PerformanceOverviewPanel 的 onStateChange 為純附加行為。
 * - 不傳 onStateChange → 行為不變（不得丟錯）。
 * - loading / error / empty / ready 四狀態要如實上報。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';

const perf = vi.hoisted(() => ({ value: { data: undefined as any, isError: false } }));
const period = vi.hoisted(() => ({ value: { data: [] as any[], isLoading: true, isError: false } }));

vi.mock('@/hooks/usePerformance', () => ({
  useExpertPerformance: () => perf.value,
  useExpertPerformanceRealtime: () => undefined,
}));
vi.mock('@/hooks/usePeriodPerformance', () => ({
  usePeriodPerformance: () => period.value,
}));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/hooks/useProjectionStatus', () => ({
  useProjectionStatus: () => ({ data: null, isLoading: false }),
}));

import { PerformanceOverviewPanel } from '@/components/strategy/PerformanceOverviewPanel';

describe('PerformanceOverviewPanel onStateChange', () => {
  beforeEach(() => {
    cleanup();
    perf.value = { data: undefined, isError: false };
    period.value = { data: [], isLoading: true, isError: false };
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
      data: [{ label: '2026', totalReturn: 0.1, equity: 1100000 } as any],
      isLoading: false,
      isError: false,
    };
    const spy = vi.fn();
    render(<PerformanceOverviewPanel expertId="e1" onStateChange={spy} />);
    await waitFor(() => expect(spy).toHaveBeenCalledWith('ready'));
  });
});
