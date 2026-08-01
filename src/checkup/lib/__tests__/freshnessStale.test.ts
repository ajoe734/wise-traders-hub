// stale 判斷的邊界條件 + harness（freezeTime=1 / force=stale）時鐘語義回歸。
//
// 背景：chips-section-visual 的 `badge STALE` 曾因 harness 覆寫 Date.now 互踩、
// 以及 ticker 太慢而不穩定。這裡把「stale 何時為 true」與「ticker 節奏」鎖死，
// 讓 harness 的 freezeTime=1 場景不再靠截圖才發現壞掉。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFreshness, tickIntervalFor, DEFAULT_TTL_MS } from '../freshness';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** 以固定 now 取得 stale 判定（跳過 ticker）。 */
function staleAt(ageMs: number, ttlMs: number = DEFAULT_TTL_MS) {
  const ts = 1_700_000_000_000;
  vi.useFakeTimers();
  vi.setSystemTime(ts + ageMs);
  const { result, unmount } = renderHook(() => useFreshness(ts, ttlMs));
  const value = result.current;
  unmount();
  return value;
}

describe('useFreshness stale 邊界', () => {
  it('age 剛好等於 TTL 不算過期（嚴格大於才 stale）', () => {
    expect(staleAt(DEFAULT_TTL_MS).stale).toBe(false);
  });

  it('age 超過 TTL 1ms 即 stale', () => {
    expect(staleAt(DEFAULT_TTL_MS + 1).stale).toBe(true);
  });

  it('TTL 前一毫秒仍新鮮', () => {
    expect(staleAt(DEFAULT_TTL_MS - 1).stale).toBe(false);
  });

  it('自訂 TTL 生效', () => {
    expect(staleAt(1_500, 1_000).stale).toBe(true);
    expect(staleAt(900, 1_000).stale).toBe(false);
  });

  it('ts 為 null / undefined / 0 時不得為 stale，也不得亮 badge', () => {
    for (const ts of [null, undefined, 0]) {
      const { result } = renderHook(() => useFreshness(ts as number | null));
      expect(result.current.stale).toBe(false);
      expect(result.current.ageMs).toBeNull();
      expect(result.current.label).toBe('—');
    }
  });

  it('未來時間戳 clamp 成 0，不會誤判 stale', () => {
    expect(staleAt(-DEFAULT_TTL_MS * 2).stale).toBe(false);
    expect(staleAt(-DEFAULT_TTL_MS * 2).ageMs).toBe(0);
  });
});

describe('harness freezeTime=1 / force=stale 語義', () => {
  it('freezeTime 凍住 Date.now → 文案與 stale 全程穩定', () => {
    vi.useFakeTimers();
    const ts = 1_700_000_000_000;
    const anchor = ts + 30_000;
    vi.setSystemTime(anchor);
    vi.spyOn(Date, 'now').mockReturnValue(anchor); // 凍結

    const { result } = renderHook(() => useFreshness(ts));
    const first = result.current.label;
    act(() => { vi.advanceTimersByTime(10 * 60_000); });

    expect(result.current.label).toBe(first);
    expect(result.current.stale).toBe(false);
  });

  it('force=stale：offset 前推 TTL+1 分鐘後，ticker 一定會把 badge 推成 stale', () => {
    vi.useFakeTimers();
    const ts = 1_700_000_000_000;
    let offset = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => ts + offset);

    const { result } = renderHook(() => useFreshness(ts));
    expect(result.current.stale).toBe(false);

    // harness 在 800ms 後把 offset 加上 TTL + 60s
    act(() => {
      offset = DEFAULT_TTL_MS + 60_000;
      vi.advanceTimersByTime(tickIntervalFor(0)); // 第一次 tick 仍用 5s 節奏
    });

    expect(result.current.stale).toBe(true);
    expect(result.current.ageMs).toBe(DEFAULT_TTL_MS + 60_000);
  });

  it('badge 亮起後不會自己熄滅（只要沒有新的 fetchedAt）', () => {
    vi.useFakeTimers();
    const ts = 1_700_000_000_000;
    let offset = DEFAULT_TTL_MS + 60_000;
    vi.spyOn(Date, 'now').mockImplementation(() => ts + offset);

    const { result } = renderHook(() => useFreshness(ts));
    expect(result.current.stale).toBe(true);

    for (let i = 0; i < 5; i++) {
      act(() => { offset += 30_000; vi.advanceTimersByTime(30_000); });
      expect(result.current.stale).toBe(true);
    }
  });

  it('ticker 節奏：stale 後改用 30s，harness 會壓成 120ms', () => {
    expect(tickIntervalFor(DEFAULT_TTL_MS + 1)).toBe(30_000);
    expect(tickIntervalFor(59_999)).toBe(5_000);
    expect(tickIntervalFor(60_000)).toBe(30_000);
  });
});
