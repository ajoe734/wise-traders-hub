import { act,renderHook } from '@testing-library/react';
import { afterEach,describe,it,expect,vi } from 'vitest';
import { useFilingRefresh } from '@/checkup/hooks/useFilingRefresh';
describe('開啟中的財報消費端刷新', () => {
  afterEach(()=>vi.useRealTimers());
  it('台北零時已開頁面刷新，離開背景後也重檢',()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-14T15:59:59Z'));
    const h=renderHook(()=>useFilingRefresh()); const old=h.result.current;
    act(()=>vi.advanceTimersByTime(1000));expect(h.result.current).toBeGreaterThan(old);
    const midnight=h.result.current;
    act(()=>{vi.setSystemTime(new Date('2026-11-14T17:00:01Z'));window.dispatchEvent(new Event('focus'));});
    expect(h.result.current).toBeGreaterThan(midnight);h.unmount();
  });
});