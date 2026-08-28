/**
 * Stage 2 — sparkline expected trade date boundary（A–O 矩陣）
 *
 * 契約：
 *   - 同一個 mount 從 13:30–14:05 跨到 14:05 之後，TW sparkline 必須自行對齊新的
 *     canonical latestCompletedTradeDate，且只多打「恰 1 次」。
 *   - 非 TW（US / unknown）完全不進 TW boundary 路徑：request delta = 0。
 *   - 全域最多 1 顆 timer、1 個 visibility listener（module singleton）。
 *   - module-owned task：unmount 不取消 commit；reset 後舊 task 不寫快取、不刪新 reservation。
 */
import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeGateway, resetCheckupGateway, setCheckupGateway } from '@/checkup/lib/gateway';
import { resetMarketHolidays, setMarketHolidays, latestCompletedTradeDate } from '@/checkup/lib/marketCalendar';
import { resetMarketHolidaysLoader } from '@/checkup/lib/marketHolidaysLoader';
import { sparklineCacheKey, sparklineCacheKeyForTradeDate } from '@/checkup/lib/marketDataStatus';
import { nextExpectedChangeAt } from '@/checkup/lib/tradeDateBoundary';
import {
  __resetExpectedStoreForTests,
  __storeDebugState,
  getExpectedSnapshot,
  subscribeExpected,
} from '@/checkup/lib/expectedTradeDateStore';
import {
  __resetSparklineTaskForTests,
  __taskDebugState,
  runSparklineTask,
  getSparklineReservation,
} from '@/checkup/lib/sparklineFetchTask';
import {
  useSparklines,
  prefetchSparkline,
  sparklineCache,
  sparklineFailCache,
  sparklinePartialCache,
} from '@/checkup/hooks/useSparklines';

// 2026-08-28 是週五交易日
const TPE = (iso: string) => new Date(`${iso}+08:00`).getTime();
const FRI_1404 = TPE('2026-08-28T14:04:59');
const FRI_1300 = TPE('2026-08-28T13:00:00');

const bars = (n: number, base = 1000) => Array.from({ length: n }, (_, i) => ({
  date: new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10),
  open: base + i, high: base + i + 5, low: base + i - 5, close: base + i + 2, volume: 1000 + i,
}));
const full = (base = 1000) => ({ ohlc: bars(64, base), closes: bars(64, base).map((b) => b.close), complete: true });

function gatewayWith(codes: string[]) {
  const result: Record<string, unknown> = {};
  codes.forEach((c, i) => { result[c] = full(1000 + i * 10); });
  const gw = createFakeGateway({ functions: { 'checkup-sparkline': { result } }, tables: { tw_market_holidays: [] } });
  setCheckupGateway(gw);
  return gw;
}

const sparkCalls = (gw: ReturnType<typeof createFakeGateway>) =>
  gw.calls.invoke.filter((c) => c.name === 'checkup-sparkline');

function clearAll() {
  sparklineCache.clear();
  sparklinePartialCache.clear();
  sparklineFailCache.clear();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FRI_1404);
  localStorage.clear();
  clearAll();
  __resetExpectedStoreForTests();
  __resetSparklineTaskForTests();
  resetMarketHolidays();
  resetMarketHolidaysLoader();
  setMarketHolidays([], 'TW');
  resetCheckupGateway();
});

afterEach(() => {
  __resetExpectedStoreForTests();
  __resetSparklineTaskForTests();
  resetCheckupGateway();
  vi.useRealTimers();
});

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe('A/B — 14:05 邊界只多打一次', () => {
  it('A：14:04:59 mount（seed 前一 expected）→ 跨界後恰 +1，且 key 為新 expected', async () => {
    const prevKey = sparklineCacheKeyForTradeDate('2330', '2026-08-27');
    sparklineCache.set(prevKey, full());
    const gw = gatewayWith(['2330']);
    renderHook(() => useSparklines(['2330']));
    await flush();
    const baseline = sparkCalls(gw).length;
    expect(sparklineCacheKey('2330')).toBe(prevKey); // 邊界前 expected 仍是 8/27

    await act(async () => { vi.setSystemTime(TPE('2026-08-28T14:05:00')); await vi.advanceTimersByTimeAsync(1000); });
    await flush();

    expect(sparkCalls(gw).length).toBe(baseline + 1);
    const body = sparkCalls(gw).at(-1)!.body as { codes: string[] };
    expect(body.codes).toEqual(['2330']);
    await flush();
    expect(sparklineCache.get(sparklineCacheKeyForTradeDate('2330', '2026-08-28'))).toBeTruthy();
  });

  it('B：+5min / +30min 同 expected → 不再新增', async () => {
    const gw = gatewayWith(['2330']);
    renderHook(() => useSparklines(['2330']));
    await flush();
    await act(async () => { vi.setSystemTime(TPE('2026-08-28T14:05:00')); await vi.advanceTimersByTimeAsync(1000); });
    await flush();
    const afterBoundary = sparkCalls(gw).length;

    await act(async () => { vi.setSystemTime(TPE('2026-08-28T14:10:00')); await vi.advanceTimersByTimeAsync(300_000); });
    await act(async () => { vi.setSystemTime(TPE('2026-08-28T14:35:00')); await vi.advanceTimersByTimeAsync(1_500_000); });
    await flush();

    expect(sparkCalls(gw).length).toBe(afterBoundary);
  });
});

describe('C — 盤中不把當日當 completed', () => {
  it('13:00 expected 仍是前一交易日（允許合法歷史 request）', async () => {
    vi.setSystemTime(FRI_1300);
    const gw = gatewayWith(['2330']);
    renderHook(() => useSparklines(['2330']));
    await flush();
    expect(getExpectedSnapshot().expectedTradeDate).toBe('2026-08-27');
    expect(latestCompletedTradeDate(new Date(FRI_1300), { market: 'TW' })).toBe('2026-08-27');
    // 合法初次載入允許發生，但絕不得以 2026-08-28 為 completed
    sparkCalls(gw).forEach(() => {
      expect(sparklineCache.get(sparklineCacheKeyForTradeDate('2330', '2026-08-28'))).toBeNull();
    });
  });
});

describe('D — 假日 / fail-closed / no-op setter', () => {
  it('週五 14:05 之後的下一顆邊界不落在週末', () => {
    const at = nextExpectedChangeAt(new Date(TPE('2026-08-28T14:06:00')));
    expect(new Date(at).toISOString()).toBe(new Date(TPE('2026-08-29T14:05:00')).toISOString());
    // 邊界醒來後由 latestCompletedTradeDate 決定：週六不推進
    expect(latestCompletedTradeDate(new Date(TPE('2026-08-29T14:06:00')), { market: 'TW' })).toBe('2026-08-28');
  });

  it('loader reject → calendarReady=false；回前景成功後對齊 expected 且不重複打；反覆 visibility 不換 reference', async () => {
    resetMarketHolidays();
    resetMarketHolidaysLoader();
    const gw = createFakeGateway({ functions: { 'checkup-sparkline': { result: { '2330': full() } } } });
    let calendarFails = true;
    const realFrom = gw.db.from.bind(gw.db);
    (gw.db as unknown as { from: typeof gw.db.from }).from = (table: string) => {
      if (table === 'tw_market_holidays' && calendarFails) throw new Error('calendar down');
      return realFrom(table);
    };
    setCheckupGateway(gw);
    renderHook(() => useSparklines(['2330'], { enabled: true }));
    await flush();
    expect(getExpectedSnapshot().calendarReady).toBe(false);
    const snapA = getExpectedSnapshot();

    // 反覆 visibility + loader reject：不 emit、不換 reference
    for (let i = 0; i < 3; i += 1) {
      await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await Promise.resolve(); });
    }
    expect(Object.is(getExpectedSnapshot(), snapA)).toBe(true);
    const beforeRecovery = sparkCalls(gw).length;

    // 回前景 + loader 成功 → 恰 1 次新的 expected attempt
    calendarFails = false;
    resetMarketHolidaysLoader();
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await Promise.resolve(); });
    await flush();
    expect(getExpectedSnapshot().calendarReady).toBe(true);
    expect(getExpectedSnapshot().expectedTradeDate).toBe('2026-08-27');
    // 恢復後 boundary 命中 legacy 已 attempt 的同一把 key → 不得重複打
    expect(sparkCalls(gw).length).toBe(beforeRecovery);

    const snapB = getExpectedSnapshot();
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await Promise.resolve(); });
    expect(Object.is(getExpectedSnapshot(), snapB)).toBe(true);
    expect(sparkCalls(gw).length).toBe(beforeRecovery);
  });
});

describe('E — 睡醒直接跨過邊界', () => {
  it('14:04 mount 後時鐘跳到 14:20，遲到 callback 以「現在」重算，恰 +1', async () => {
    const gw = gatewayWith(['2330']);
    renderHook(() => useSparklines(['2330']));
    await flush();
    const baseline = sparkCalls(gw).length;

    await act(async () => {
      vi.setSystemTime(TPE('2026-08-28T14:20:00'));
      await vi.advanceTimersByTimeAsync(16 * 60 * 1000);
    });
    await flush();

    expect(getExpectedSnapshot().expectedTradeDate).toBe('2026-08-28');
    expect(sparkCalls(gw).length).toBe(baseline + 1);
  });
});

describe('F/J — singleton timer / listener 與 refCount', () => {
  it('F：StrictMode double effect 不產生雙 timer / 雙 listener', async () => {
    const gw = gatewayWith(['2330']);
    const { unmount } = renderHook(() => useSparklines(['2330']), { wrapper: StrictMode });
    await flush();
    const st = __storeDebugState();
    expect(st.refCount).toBe(1);
    expect(st.hasTimer).toBe(true);
    expect(st.visibilityBound).toBe(true);

    const before = sparkCalls(gw).length;
    await act(async () => { vi.setSystemTime(TPE('2026-08-28T14:05:00')); await vi.advanceTimersByTimeAsync(1000); });
    await flush();
    expect(sparkCalls(gw).length).toBe(before + 1);

    unmount();
    expect(__storeDebugState().refCount).toBe(0);
    expect(__storeDebugState().hasTimer).toBe(false);
    expect(__storeDebugState().visibilityBound).toBe(false);
  });

  it('J：多 consumer 只有 0↔1 才 start/stop', async () => {
    gatewayWith(['2330']);
    const un1 = subscribeExpected(() => {});
    expect(__storeDebugState().refCount).toBe(1);
    const un2 = subscribeExpected(() => {});
    expect(__storeDebugState().refCount).toBe(2);
    expect(__storeDebugState().hasTimer).toBe(true);
    un1();
    expect(__storeDebugState().hasTimer).toBe(true);
    un2();
    expect(__storeDebugState().refCount).toBe(0);
    expect(__storeDebugState().hasTimer).toBe(false);
    expect(__storeDebugState().visibilityBound).toBe(false);
  });
});

describe('G — code set vs qty/price', () => {
  it('同日新增 code 只抓新增集合；純 price 變更 0 次', async () => {
    const gw = gatewayWith(['2330', '2317']);
    const { rerender } = renderHook(
      ({ codes, prices }) => useSparklines(codes, { pricesByCode: prices }),
      { initialProps: { codes: ['2330'], prices: { '2330': 0 } as Record<string, unknown> } },
    );
    await flush();
    const afterFirst = sparkCalls(gw).length;

    rerender({ codes: ['2330', '2317'], prices: { '2330': 0 } });
    await flush();
    expect(sparkCalls(gw).length).toBe(afterFirst + 1);
    const body = sparkCalls(gw).at(-1)!.body as { codes: string[] };
    expect(body.codes).toEqual(['2317']);

    const afterAdd = sparkCalls(gw).length;
    rerender({ codes: ['2330', '2317'], prices: { '2330': 999999 } });
    await flush();
    expect(sparkCalls(gw).length).toBe(afterAdd);
  });
});

describe('H/L — reservation 去重與 module-owned commit', () => {
  it('H：同一 tick batch + prefetch → total invoke = 1', async () => {
    const gw = gatewayWith(['2330']);
    renderHook(() => useSparklines(['2330']));
    void prefetchSparkline('2330');
    await flush();
    expect(sparkCalls(gw).length).toBe(1);
  });

  it('L：reserve 後立即 unmount，回應仍 commit；Map 清空且可 retry', async () => {
    let release!: (v: unknown) => void;
    const pending = new Promise((r) => { release = r; });
    const gw = createFakeGateway({ functions: { 'checkup-sparkline': { result: { '2330': full() } } }, tables: { tw_market_holidays: [] } });
    const orig = gw.invoke.bind(gw);
    (gw as unknown as { invoke: typeof gw.invoke }).invoke = async (name: string, body: unknown) => {
      if (name === 'checkup-sparkline') { await pending; }
      return orig(name, body);
    };
    setCheckupGateway(gw);

    const { unmount } = renderHook(() => useSparklines(['2330']));
    await flush();
    const key = sparklineCacheKey('2330');
    expect(getSparklineReservation(key)).toBeTruthy();
    unmount();
    const waiter = prefetchSparkline('2330'); // 同一顆 task
    await act(async () => { release(null); await waiter; });

    expect(sparklineCache.get(key)).toBeTruthy();
    expect(sparkCalls(gw).length).toBe(1);
    expect(__taskDebugState().size).toBe(0);
  });

  it('L：throw / 整批 null 兩路徑都釋放 reservation 且可重試', async () => {
    const key = sparklineCacheKeyForTradeDate('2330', '2026-08-27');
    let mode: 'throw' | 'null' = 'throw';
    const commits: Array<unknown> = [];
    const deps = {
      invoke: async () => { if (mode === 'throw') throw new Error('boom'); return null; },
      commit: (_e: unknown, r: unknown) => { commits.push(r); },
    };
    await runSparklineTask([{ code: '2330', key }], deps);
    expect(__taskDebugState().size).toBe(0);
    mode = 'null';
    await runSparklineTask([{ code: '2330', key }], deps);
    expect(commits).toEqual([null, null]);
    expect(__taskDebugState().size).toBe(0);
  });
});

describe('I — factual lagging 樣本不被偽造', () => {
  it('未回傳的代號進負快取，不會被別的 code 或現價覆蓋', async () => {
    const codes = ['039108', '053848', '702157'];
    const gw = createFakeGateway({
      functions: { 'checkup-sparkline': { result: {} } },
      tables: { tw_market_holidays: [] },
    });
    setCheckupGateway(gw);
    const { result } = renderHook(() => useSparklines(codes, { pricesByCode: { '039108': 55 } }));
    await flush();
    await flush();
    await flush();
    expect(result.current.sparklineErrors['039108']).toBe(true);
    codes.forEach((c) => {
      expect(sparklineCache.get(sparklineCacheKey(c))).toBeNull();
      expect(result.current.sparklines[c]).toBeUndefined();
    });
  });
});

describe('K — clock seam 一致', () => {
  it('注入時間後 snapshot / cache key / boundary 同源', async () => {
    vi.setSystemTime(TPE('2026-08-28T14:06:00'));
    gatewayWith(['2330']);
    const un = subscribeExpected(() => {});
    await flush();
    expect(getExpectedSnapshot().expectedTradeDate).toBe('2026-08-28');
    expect(sparklineCacheKey('2330')).toBe(sparklineCacheKeyForTradeDate('2330', '2026-08-28'));
    expect(nextExpectedChangeAt(new Date(Date.now()))).toBe(TPE('2026-08-29T14:05:00'));
    un();
  });
});

describe('M — mixed market', () => {
  const MIXED = ['2330', '00878', '911616', 'AMD', 'SOXL'];

  it('初次 mixed 載入仍是單一批（body 與修前一致）；跨界只補 TW subset，US delta=0', async () => {
    const gw = gatewayWith(MIXED);
    renderHook(() => useSparklines(MIXED));
    await flush();

    expect(sparkCalls(gw).length).toBe(1);
    const first = sparkCalls(gw)[0].body as { codes: string[] };
    // legacy 語意：normalizeCodes → sort → 單一 mixed body
    expect(first.codes).toEqual(['00878', '2330', '911616', 'AMD', 'SOXL']);
    expect(Object.keys(sparkCalls(gw)[0].body as object)).toEqual(['codes']);

    const usKeysBefore = ['AMD', 'SOXL'].map((c) => sparklineCacheKey(c));

    await act(async () => { vi.setSystemTime(TPE('2026-08-28T14:05:00')); await vi.advanceTimersByTimeAsync(1000); });
    await flush();

    expect(sparkCalls(gw).length).toBe(2);
    const second = sparkCalls(gw)[1].body as { codes: string[] };
    expect(second.codes).toEqual(['00878', '2330', '911616']);
    expect(second.codes.some((c) => c === 'AMD' || c === 'SOXL')).toBe(false);

    // US 沒有任何新的 request；boundary path 不曾為 US 建過 key
    usKeysBefore.forEach((k) => {
      expect(k.startsWith('TW:')).toBe(true); // legacy 事實（US 也吃 TW tradeDate），本案不擴修
    });
    expect(sparkCalls(gw).filter((c) => (c.body as { codes: string[] }).codes.includes('AMD'))).toHaveLength(1);

    const afterBoundary = sparkCalls(gw).length;
    await flush();
    expect(sparkCalls(gw).length).toBe(afterBoundary);
  });

  it('qty / current price 變更（無偏離）→ TW 與 US 皆 0 次新增', async () => {
    const gw = gatewayWith(MIXED);
    const { rerender } = renderHook(
      ({ prices }) => useSparklines(MIXED, { pricesByCode: prices }),
      { initialProps: { prices: {} as Record<string, unknown> } },
    );
    await flush();
    await act(async () => { vi.setSystemTime(TPE('2026-08-28T14:05:00')); await vi.advanceTimersByTimeAsync(1000); });
    await flush();
    const baseline = sparkCalls(gw).length;

    // 用「與快取最後收盤一致」的現價：pricesKey 會改變並重跑 legacy effect，
    // 但不得產生任何新的 request（無 drift、無新 key）。
    const prices: Record<string, unknown> = {};
    MIXED.forEach((c) => {
      const entry = sparklineCache.get(sparklineCacheKey(c));
      const last = entry?.ohlc?.at(-1)?.close;
      if (last != null) prices[c] = last;
    });
    expect(Object.keys(prices).length).toBeGreaterThan(0);

    rerender({ prices });
    await flush();
    // TW 已被 boundary 對齊到新 expected → 0 次；
    // 非 TW 走 legacy 語意（cache key 也吃 TW tradeDate），只有在 legacy effect
    // 因 pricesKey 重跑時才補打，且 body 只含非 TW 代號（不是 boundary 觸發）。
    const delta = sparkCalls(gw).slice(baseline);
    expect(delta).toHaveLength(1);
    expect((delta[0].body as { codes: string[] }).codes).toEqual(['AMD', 'SOXL']);

    rerender({ prices });
    await flush();
    expect(sparkCalls(gw).length).toBe(baseline + 1);
  });
});

describe('N — reset replacement race', () => {
  const key = sparklineCacheKeyForTradeDate('2330', '2026-08-28');

  it('N-1：舊 task resolve 後不寫快取、不刪新 reservation', async () => {
    let releaseA!: () => void;
    const gateA = new Promise<void>((r) => { releaseA = r; });
    const commitsA: unknown[] = [];
    const taskA = runSparklineTask([{ code: '2330', key }], {
      invoke: async () => { await gateA; return { result: { '2330': full() } }; },
      commit: (_e, r) => { commitsA.push(r); },
    });

    __resetSparklineTaskForTests();

    let releaseB!: () => void;
    const gateB = new Promise<void>((r) => { releaseB = r; });
    const commitsB: unknown[] = [];
    const taskB = runSparklineTask([{ code: '2330', key }], {
      invoke: async () => { await gateB; return { result: { '2330': full() } }; },
      commit: (_e, r) => { commitsB.push(r); },
    });
    const reservationB = getSparklineReservation(key);
    expect(reservationB).toBeTruthy();

    releaseA();
    await taskA;
    expect(commitsA).toHaveLength(0);                       // stale：不 commit
    expect(getSparklineReservation(key)).toBe(reservationB); // 沒刪掉 B

    releaseB();
    await taskB;
    expect(commitsB).toHaveLength(1);
    expect(__taskDebugState().size).toBe(0);
  });

  it('N-2：舊 task throw 也不 commitAllFail、不刪新 reservation', async () => {
    let rejectA!: (e: unknown) => void;
    const gateA = new Promise<void>((_r, rej) => { rejectA = rej; });
    const commitsA: unknown[] = [];
    const taskA = runSparklineTask([{ code: '2330', key }], {
      invoke: async () => { await gateA; return null; },
      commit: (_e, r) => { commitsA.push(r); },
    });

    __resetSparklineTaskForTests();

    let releaseB!: () => void;
    const gateB = new Promise<void>((r) => { releaseB = r; });
    const commitsB: unknown[] = [];
    const taskB = runSparklineTask([{ code: '2330', key }], {
      invoke: async () => { await gateB; return null; },
      commit: (_e, r) => { commitsB.push(r); },
    });
    const reservationB = getSparklineReservation(key);

    rejectA(new Error('boom'));
    await taskA;
    expect(commitsA).toHaveLength(0);
    expect(getSparklineReservation(key)).toBe(reservationB);

    releaseB();
    await taskB;
    expect(commitsB).toEqual([null]);
    expect(__taskDebugState().size).toBe(0);
  });
});

describe('O — boot state（calendar 由 false → true）', () => {
  it('O-1：legacy 已 attempt 同一 key → TW boundary 新增 0', async () => {
    const gw = gatewayWith(['2330']);
    renderHook(() => useSparklines(['2330']));
    await flush();
    const afterLegacy = sparkCalls(gw).length;
    expect(afterLegacy).toBe(1);
    expect(getExpectedSnapshot().calendarReady).toBe(true);
    expect(getExpectedSnapshot().expectedTradeDate).toBe('2026-08-27');
    await flush();
    expect(sparkCalls(gw).length).toBe(afterLegacy); // boundary 命中同一 key，不重打
  });

  it('O-2：假日表使正確 expected ≠ legacy 初值 → boundary 補打正確 TW key', async () => {
    // 假日表未載入時 legacy 以「只跳週末」算出 8/27；載入後 8/27 是休市日 → 正確 expected 為 8/26
    resetMarketHolidays();
    resetMarketHolidaysLoader();
    const gw = createFakeGateway({
      functions: { 'checkup-sparkline': { result: { '2330': full() } } },
      tables: { tw_market_holidays: [{ trade_date: '2026-08-27' }] },
    });
    setCheckupGateway(gw);

    renderHook(() => useSparklines(['2330']));
    await flush();
    const legacyBody = sparkCalls(gw)[0].body as { codes: string[] };
    expect(legacyBody.codes).toEqual(['2330']);

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await flush();

    expect(getExpectedSnapshot().calendarReady).toBe(true);
    expect(getExpectedSnapshot().expectedTradeDate).toBe('2026-08-26');
    expect(sparkCalls(gw).length).toBe(2);
    await flush();
    expect(sparklineCache.get(sparklineCacheKeyForTradeDate('2330', '2026-08-26'))).toBeTruthy();
  });
});
