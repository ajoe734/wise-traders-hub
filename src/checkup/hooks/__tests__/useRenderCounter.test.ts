/**
 * useRenderCounter — 行為驗證
 *
 * 憲法：dev/test 啟用；生產環境為 no-op（此測試在 vitest 環境跑，屬 dev 分支）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  useRenderCounter,
  getRenderStats,
  resetRenderStats,
} from '@/checkup/hooks/useRenderCounter';

describe('useRenderCounter', () => {
  beforeEach(() => {
    resetRenderStats();
    vi.restoreAllMocks();
  });

  it('每次 render 遞增 total 與 windowCount', () => {
    const { rerender } = renderHook(() => useRenderCounter('TestA', { id: '1' }));
    expect(getRenderStats('TestA', '1')?.total).toBe(1);
    rerender();
    rerender();
    const s = getRenderStats('TestA', '1');
    expect(s?.total).toBe(3);
    expect(s?.windowCount).toBe(3);
    expect(s?.warned).toBe(false);
  });

  it('同一 windowMs 內超過 warnThreshold 時 console.warn 一次', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { rerender } = renderHook(() =>
      useRenderCounter('TestB', { id: 'x', warnThreshold: 3, windowMs: 5000 }),
    );
    // total = 1
    rerender(); // 2
    rerender(); // 3
    expect(warn).not.toHaveBeenCalled();
    rerender(); // 4 → 觸發
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/TestB::x/);
    // 幂等：再 render 也不重複 warn
    rerender();
    rerender();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(getRenderStats('TestB', 'x')?.warned).toBe(true);
  });

  it('id 省略時以 label 為鍵彙總', () => {
    const { rerender } = renderHook(() => useRenderCounter('GlobalC'));
    rerender();
    expect(getRenderStats('GlobalC')?.total).toBe(2);
    // 不同 id 走不同計數器
    renderHook(() => useRenderCounter('GlobalC', { id: 'other' }));
    expect(getRenderStats('GlobalC')?.total).toBe(2);
    expect(getRenderStats('GlobalC', 'other')?.total).toBe(1);
  });

  it('resetRenderStats(label,id) 只清指定鍵', () => {
    renderHook(() => useRenderCounter('R', { id: 'a' }));
    renderHook(() => useRenderCounter('R', { id: 'b' }));
    resetRenderStats('R', 'a');
    expect(getRenderStats('R', 'a')?.total).toBe(0);
    expect(getRenderStats('R', 'b')?.total).toBe(1);
  });
});
