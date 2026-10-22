import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSummaryReveal } from '@/checkup/components/freecheckup/HoldingsVisualSummary';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('summary reveal lifecycle', () => {
  it('repeated replay cancels the old timer and unmount clears the final one', () => {
    vi.useFakeTimers(); vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const { result, unmount } = renderHook(() => useSummaryReveal());
    act(() => { result.current.replay(); result.current.replay(); result.current.replay(); });
    expect(vi.getTimerCount()).toBe(1); expect(result.current.on).toBe(false);
    act(() => vi.advanceTimersByTime(60)); expect(result.current.on).toBe(true);
    act(() => result.current.replay());
    unmount(); expect(vi.getTimerCount()).toBe(0);
  });
  it('reduced motion immediately reveals with no timer', () => {
    vi.useFakeTimers(); vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const { result } = renderHook(() => useSummaryReveal());
    act(() => result.current.replay()); expect(result.current.on).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
});