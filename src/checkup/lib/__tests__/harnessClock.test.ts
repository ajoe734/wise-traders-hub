import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  installHarnessClock,
  resolveMode,
  parseEpoch,
  STALE_SHIFT_DEFAULT_MS,
  TICKER_INTERVALS_MS,
} from '../harnessClock';

let clock: { uninstall: () => void } | null = null;
afterEach(() => {
  clock?.uninstall();
  clock = null;
  vi.useRealTimers();
});

describe('resolveMode 權重：fresh > stale', () => {
  it('單一值', () => {
    expect(resolveMode('stale')).toBe('stale');
    expect(resolveMode('fresh')).toBe('fresh');
    expect(resolveMode('offline')).toBeNull();
    expect(resolveMode(null)).toBeNull();
  });

  it('同時出現時 fresh 勝出（不論順序與分隔符）', () => {
    expect(resolveMode('stale,fresh')).toBe('fresh');
    expect(resolveMode('fresh,stale')).toBe('fresh');
    expect(resolveMode('stale fresh')).toBe('fresh');
    expect(resolveMode('stale+fresh')).toBe('fresh');
  });
});

describe('parseEpoch', () => {
  it('接受 epoch ms 與 ISO', () => {
    expect(parseEpoch('1700000000000')).toBe(1_700_000_000_000);
    expect(parseEpoch('2026-07-20T09:30:00.000Z')).toBe(Date.parse('2026-07-20T09:30:00.000Z'));
  });
  it('無效輸入回 null', () => {
    expect(parseEpoch(null)).toBeNull();
    expect(parseEpoch('')).toBeNull();
    expect(parseEpoch('not-a-date')).toBeNull();
    expect(parseEpoch('0')).toBeNull();
  });
});

describe('installHarnessClock 覆寫規則', () => {
  it('全空 → 不安裝覆寫，Date.now 不被動到', () => {
    const before = Date.now;
    clock = installHarnessClock();
    expect((clock as any).active).toBe(false);
    expect(Date.now).toBe(before);
  });

  it('fixedNow 釘死時鐘，不隨真實時間前進', () => {
    vi.useFakeTimers();
    const pinned = 1_700_000_000_000;
    clock = installHarnessClock({ fixedNow: pinned });
    expect(Date.now()).toBe(pinned);
    vi.advanceTimersByTime(10 * 60_000);
    expect(Date.now()).toBe(pinned);
  });

  it('mode=stale：位移前保留原時刻，位移後加上 staleShiftMs', () => {
    vi.useFakeTimers();
    const pinned = 1_700_000_000_000;
    const onShift = vi.fn();
    const c = installHarnessClock({ mode: 'stale', fixedNow: pinned, staleAfterMs: 300, onShift });
    clock = c;
    expect(Date.now()).toBe(pinned);
    vi.advanceTimersByTime(299);
    expect(Date.now()).toBe(pinned);
    vi.advanceTimersByTime(1);
    expect(Date.now()).toBe(pinned + STALE_SHIFT_DEFAULT_MS);
    expect(onShift).toHaveBeenCalledTimes(1);
  });

  it('mode=stale：shiftNow 可立刻套用，且不重複觸發', () => {
    vi.useFakeTimers();
    const pinned = 1_700_000_000_000;
    const onShift = vi.fn();
    const c = installHarnessClock({ mode: 'stale', fixedNow: pinned, onShift });
    clock = c;
    c.shiftNow();
    c.shiftNow();
    expect(Date.now()).toBe(pinned + STALE_SHIFT_DEFAULT_MS);
    expect(onShift).toHaveBeenCalledTimes(1);
  });

  it('mode=stale：只壓縮 freshness ticker 的 5s/30s，其他 delay 不動', () => {
    const seen: Array<number | undefined> = [];
    const original = globalThis.setTimeout;
    (globalThis as any).setTimeout = ((fn: any, d?: number, ...a: any[]) => {
      seen.push(d);
      return original(fn, 0 as any, ...a);
    }) as any;
    try {
      const c = installHarnessClock({ mode: 'stale', staleAfterMs: 999_999 });
      seen.length = 0;
      for (const d of [...TICKER_INTERVALS_MS, 1_234]) globalThis.setTimeout(() => {}, d);
      c.uninstall();
      expect(seen).toEqual([120, 120, 1_234]);
    } finally {
      (globalThis as any).setTimeout = original;
    }
  });

  it('mode=fresh：權重最高，永不位移、不壓縮 ticker', () => {
    vi.useFakeTimers();
    const pinned = 1_700_000_000_000;
    const onShift = vi.fn();
    const c = installHarnessClock({ mode: 'fresh', fixedNow: pinned, staleAfterMs: 10, onShift });
    clock = c;
    vi.advanceTimersByTime(60_000);
    expect(Date.now()).toBe(pinned);
    expect(onShift).not.toHaveBeenCalled();
    // fresh 下 shiftNow 亦為 no-op
    c.shiftNow();
    expect(Date.now()).toBe(pinned);
  });

  it('mode=fresh 可用 freshAt 指定釘住的時刻', () => {
    const at = 1_650_000_000_000;
    clock = installHarnessClock({ mode: 'fresh', freshAt: at });
    expect(Date.now()).toBe(at);
  });

  it('freeze：凍結在 install 當下', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    clock = installHarnessClock({ freeze: true });
    const first = Date.now();
    vi.advanceTimersByTime(120_000);
    expect(Date.now()).toBe(first);
  });

  it('未凍結時 base 跟隨真實時間，位移與 base 正交', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const c = installHarnessClock({ mode: 'stale', staleAfterMs: 100 });
    clock = c;
    const t0 = Date.now();
    vi.advanceTimersByTime(100);
    expect(Date.now()).toBe(t0 + 100 + STALE_SHIFT_DEFAULT_MS);
  });

  it('uninstall 完整還原 Date.now 與 setTimeout', () => {
    const now = Date.now;
    const st = globalThis.setTimeout;
    const c = installHarnessClock({ mode: 'stale', fixedNow: 1_700_000_000_000 });
    expect(Date.now).not.toBe(now);
    expect(globalThis.setTimeout).not.toBe(st);
    c.uninstall();
    expect(Date.now).toBe(now);
    expect(globalThis.setTimeout).toBe(st);
  });
});
