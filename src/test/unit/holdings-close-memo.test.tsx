/**
 * Stage 1 — banner integration：refreshPrices 只改收盤身分（price 不變）時，
 * FreeCheckup 的 H memo（useMemo(holdings, [holdingsValueKeyShort(holdings)])）
 * 必須失效，讓 HoldingsHero 的 summarizeCloseAlignment 讀到新的 close identity。
 *
 * 修 holdingsValueKeyShort 之前此測必紅（memo 命中舊 array → confirmed 維持 0）。
 */
import { renderHook } from '@testing-library/react';
import { useMemo } from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { holdingsValueKeyShort } from '@/checkup/lib/holdingsSort';
import { summarizeCloseAlignment } from '@/checkup/lib/closeAlignment';

// 台北 2026-08-28 22:55 → latestCompletedTradeDate = 2026-08-28
const NOW = new Date('2026-08-28T14:55:00Z');

const EMPTY: any[] = [];

/** 與 FreeCheckup.jsx:1227-1229 同語意的 memo path。 */
function useH(holdings: any[]) {
  const key = useMemo(() => holdingsValueKeyShort(holdings), [holdings]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => holdings || EMPTY, [key]);
}

const pendingRow = (code: string) => ({
  code, qty: 1000, price: 100, cost: 90,
  priceTradeDate: '2026-08-27', priceState: 'pending', priceSource: 'current', priceError: null,
});
const confirmedRow = (code: string) => ({
  ...pendingRow(code),
  priceTradeDate: '2026-08-28', priceState: 'confirmed', priceSource: 'close',
});

afterEach(() => vi.useRealTimers());

describe('holdings close identity → banner memo', () => {
  it('price 不變、只有收盤身分 pending→confirmed：banner 由 2/2 待確認收斂為已對齊', () => {
    const codes = ['2330', '3491'];
    const { result, rerender } = renderHook(({ h }) => useH(h), {
      initialProps: { h: codes.map(pendingRow) },
    });

    const before = summarizeCloseAlignment(result.current as any, NOW);
    expect(before.confirmed).toBe(0);
    expect(before.pending).toBe(2);

    rerender({ h: codes.map(confirmedRow) });

    const after = summarizeCloseAlignment(result.current as any, NOW);
    expect(after.confirmed).toBe(2);
    expect(after.pending).toBe(0);
    expect(after.aligned).toBe(true);
  });

  it('上游落後者誠實維持 pending，不被偽造成已對齊', () => {
    const { result, rerender } = renderHook(({ h }) => useH(h), {
      initialProps: { h: [pendingRow('2330'), pendingRow('039108')] },
    });
    rerender({ h: [confirmedRow('2330'), pendingRow('039108')] });

    const s = summarizeCloseAlignment(result.current as any, NOW);
    expect(s.confirmed).toBe(1);
    expect(s.pending).toBe(1);
    expect(s.aligned).toBe(false);
    expect(s.otherDates).toEqual(['2026-08-27']);
  });

  it('完全沒有變動時 H reference 保持穩定（效能契約不破）', () => {
    const rows = [pendingRow('2330')];
    const { result, rerender } = renderHook(({ h }) => useH(h), { initialProps: { h: rows } });
    const first = result.current;
    rerender({ h: rows.map((r) => ({ ...r })) });
    expect(result.current).toBe(first);
  });
});
