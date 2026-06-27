// useSimHistory：覆蓋 undo/redo、debounce 合併、欄位切換斷點、上限、清空、reset。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSimHistory } from '@/checkup/hooks/useSimHistory';

type S = { target: string | number; deltaQty: number; buyMorePrice: string; stopPrice: string };
const initial: S = { target: 100, deltaQty: 0, buyMorePrice: '', stopPrice: '' };

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { vi.useRealTimers(); });

describe('useSimHistory', () => {
  it('set / undo / redo 基本流程', () => {
    const { result } = renderHook(() => useSimHistory<S>(initial));
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.set((s) => ({ ...s, target: 110 }), 'target'));
    act(() => { vi.advanceTimersByTime(400); });
    act(() => result.current.set((s) => ({ ...s, target: 120 }), 'target'));
    expect(result.current.state.target).toBe(120);
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.undo());
    expect(result.current.state.target).toBe(110);
    act(() => result.current.undo());
    expect(result.current.state.target).toBe(100);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.redo());
    expect(result.current.state.target).toBe(110);
  });

  it('300ms 內同欄位連續 set 合併為一筆 history', () => {
    const { result } = renderHook(() => useSimHistory<S>(initial));
    act(() => result.current.set((s) => ({ ...s, deltaQty: 10 }), 'deltaQty'));
    act(() => { vi.advanceTimersByTime(50); });
    act(() => result.current.set((s) => ({ ...s, deltaQty: 20 }), 'deltaQty'));
    act(() => { vi.advanceTimersByTime(50); });
    act(() => result.current.set((s) => ({ ...s, deltaQty: 30 }), 'deltaQty'));
    expect(result.current.state.deltaQty).toBe(30);
    act(() => result.current.undo());
    // 應一次回到 initial（合併後僅 1 筆 history）
    expect(result.current.state.deltaQty).toBe(0);
    expect(result.current.canUndo).toBe(false);
  });

  it('切換欄位立即斷點，不合併', () => {
    const { result } = renderHook(() => useSimHistory<S>(initial));
    act(() => result.current.set((s) => ({ ...s, target: 110 }), 'target'));
    act(() => result.current.set((s) => ({ ...s, deltaQty: 5 }), 'deltaQty'));
    act(() => result.current.undo());
    expect(result.current.state.deltaQty).toBe(0);
    expect(result.current.state.target).toBe(110);
    act(() => result.current.undo());
    expect(result.current.state.target).toBe(100);
  });

  it('set 後 redo 會被清空', () => {
    const { result } = renderHook(() => useSimHistory<S>(initial));
    act(() => result.current.set((s) => ({ ...s, target: 110 }), 'target'));
    act(() => { vi.advanceTimersByTime(400); });
    act(() => result.current.set((s) => ({ ...s, target: 120 }), 'target'));
    act(() => result.current.undo());
    expect(result.current.canRedo).toBe(true);
    act(() => { vi.advanceTimersByTime(400); });
    act(() => result.current.set((s) => ({ ...s, target: 130 }), 'target'));
    expect(result.current.canRedo).toBe(false);
  });

  it('clear 清空 past/future', () => {
    const { result } = renderHook(() => useSimHistory<S>(initial));
    act(() => result.current.set((s) => ({ ...s, target: 999 }), 'target'));
    act(() => result.current.clear({ target: 50, deltaQty: 0, buyMorePrice: '', stopPrice: '' }));
    expect(result.current.state.target).toBe(50);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it('past 上限 50 步滾動丟棄最舊', () => {
    const { result } = renderHook(() => useSimHistory<S>(initial));
    for (let i = 1; i <= 60; i++) {
      act(() => result.current.set((s) => ({ ...s, target: i }), `f${i}`));
    }
    // undo 60 次：上限後最舊 10 步丟失，最早只能 undo 回到 step 10 的舊值（即 target=10）
    for (let i = 0; i < 50; i++) act(() => result.current.undo());
    expect(result.current.canUndo).toBe(false);
    // 不會回到 100（initial 已被擠出）
    expect(result.current.state.target).not.toBe(100);
  });

  it('reset 寫入 history，可 undo 回到之前的調整', () => {
    const { result } = renderHook(() => useSimHistory<S>(initial));
    act(() => result.current.set((s) => ({ ...s, target: 110 }), 'target'));
    act(() => result.current.reset({ target: 999, deltaQty: 0, buyMorePrice: '', stopPrice: '' }));
    expect(result.current.state.target).toBe(999);
    act(() => result.current.undo());
    expect(result.current.state.target).toBe(110);
  });
});
