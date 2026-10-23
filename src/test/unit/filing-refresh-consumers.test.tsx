import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeGateway } from '@/checkup/lib/gateway/fakeGateway';
import { loadFundamentals, __resetFundamentalsCache, FUNDAMENTALS_FN } from '@/checkup/hooks/useValuationSnapshot';
import { useValuationSnapshot } from '@/checkup/hooks/useValuationSnapshot';
import { setCheckupGateway, resetCheckupGateway } from '@/checkup/lib/gateway';
import { usePricedInList } from '@/checkup/components/freecheckup/usePricedInList';
import { useStationExtras } from '@/checkup/hooks/useStationExtras';
import peerGroups from '@/checkup/data/valuationPeerGroups.json';
import { industryByCode } from '@/checkup/lib/industryCodes';

async function settle() {
  await act(async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); });
}

describe('財報更新公開快取邊界', () => {
  beforeEach(() => { vi.useFakeTimers(); __resetFundamentalsCache(); });
  afterEach(() => { cleanup(); resetCheckupGateway(); vi.useRealTimers(); });

  it('跨過台北申報期限才抵達的舊請求，不冒充隔天新財報', async () => {
    vi.setSystemTime(new Date('2026-11-14T15:59:59Z'));
    const responses = { [FUNDAMENTALS_FN]: { rows: [{ key: 'pe', basis: { value: 4 } }], basis: { latestPeriod: '2026-06-30' } } };
    const gw = createFakeGateway({ functions: responses });
    let release: (value: typeof responses[typeof FUNDAMENTALS_FN]) => void = () => {};
    const originalInvoke = gw.invoke.bind(gw);
    const delayed = new Promise<typeof responses[typeof FUNDAMENTALS_FN]>((resolve) => { release = resolve; });
    gw.invoke = (() => delayed) as typeof gw.invoke;
    const pending = loadFundamentals(gw, '9876', false, false);
    vi.setSystemTime(new Date('2026-11-14T16:00:01Z'));
    release(responses[FUNDAMENTALS_FN]);
    await pending;
    responses[FUNDAMENTALS_FN] = { rows: [{ key: 'pe', basis: { value: 7 } }], basis: { latestPeriod: '2026-09-30' } };
    gw.invoke = originalInvoke;
    const refreshed = await loadFundamentals(gw, '9876', false, false);
    expect(refreshed).toMatchObject({ basis: { latestPeriod: '2026-09-30' }, rows: [{ basis: { value: 7 } }] });
  });

  it.each([
    { peers: false, elapsed: 2000, start: '2026-11-14T15:59:59Z' }, { peers: true, elapsed: 2000, start: '2026-11-14T15:59:59Z' },
    { peers: false, elapsed: 3600000, start: '2026-11-14T00:00:00Z' }, { peers: true, elapsed: 3600000, start: '2026-11-14T00:00:00Z' },
  ])('跨日或滿一小時後不沿用舊在途請求：$peers / $elapsed', async ({ peers, elapsed, start }) => {
    vi.setSystemTime(new Date(start));
    const oldPayload = { rows: [{ key: 'pe', basis: { value: 4 } }], basis: { latestPeriod: '2026-06-30' } };
    const newPayload = { rows: [{ key: 'pe', basis: { value: 7 } }], basis: { latestPeriod: '2026-09-30' } };
    let releaseOld: (value: typeof oldPayload) => void = () => {};
    const oldResponse = new Promise<typeof oldPayload>((resolve) => { releaseOld = resolve; });
    const gw = createFakeGateway({ functions: { [FUNDAMENTALS_FN]: newPayload } });
    const invoke = vi.fn().mockReturnValueOnce(oldResponse).mockResolvedValue(newPayload);
    gw.invoke = invoke as typeof gw.invoke;
    const beforeDeadline = loadFundamentals(gw, '9876', false, peers);
    vi.setSystemTime(Date.now() + elapsed);
    const afterDeadline = loadFundamentals(gw, '9876', false, peers);
    releaseOld(oldPayload);
    await beforeDeadline;
    expect(await afterDeadline).toMatchObject({ basis: { latestPeriod: '2026-09-30' }, rows: [{ basis: { value: 7 } }] });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])('舊請求完成不刪除新在途請求，也不覆蓋其快取（peers=%s）', async (peers) => {
    vi.setSystemTime(new Date('2026-11-14T15:59:59Z'));
    const oldPayload = { rows: [{ key: 'pe', basis: { value: 4 } }], basis: { latestPeriod: '2026-06-30' } };
    const newPayload = { rows: [{ key: 'pe', basis: { value: 7 } }], basis: { latestPeriod: '2026-09-30' } };
    let releaseOld: (value: typeof oldPayload) => void = () => {};
    let releaseNew: (value: typeof newPayload) => void = () => {};
    const oldResponse = new Promise<typeof oldPayload>((resolve) => { releaseOld = resolve; });
    const newResponse = new Promise<typeof newPayload>((resolve) => { releaseNew = resolve; });
    const gw = createFakeGateway({ functions: { [FUNDAMENTALS_FN]: newPayload } });
    const invoke = vi.fn().mockReturnValueOnce(oldResponse).mockReturnValueOnce(newResponse).mockResolvedValue(newPayload);
    gw.invoke = invoke as typeof gw.invoke;
    const old = loadFundamentals(gw, '9876', false, peers);
    vi.setSystemTime(new Date('2026-11-14T16:00:01Z'));
    const fresh = loadFundamentals(gw, '9876', false, peers);
    releaseOld(oldPayload);
    await old;
    const shared = loadFundamentals(gw, '9876', false, peers);
    expect(shared).toBe(fresh);
    releaseNew(newPayload);
    await fresh;
    expect(await loadFundamentals(gw, '9876', false, peers)).toMatchObject(newPayload);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it.each(['midnight', 'hourly', 'focus', 'visibility'] as const)('%s 後清單、抽屜及同業都讀回更新，不沿用舊資料', async (trigger) => {
    vi.setSystemTime(new Date('2026-11-14T15:59:59Z'));
    const symbol = peerGroups.groups[0].symbols[0];
    const rpcResponses = {
      valuation_snapshot: { symbol, asOf: '2026-11-14', history: { pe: [], pb: [], dividendYield: [] }, peers: [] },
      valuation_peer_multiples: [{ symbol: '9876', trade_date: '2026-11-14', pe: 10, pb: 2, ps: 3 }],
      forward_estimate_for: [{ eps: 5, period: '2027', eps_source: '公開財報', as_of: '2026-11-14' }],
    };
    const responses = { [FUNDAMENTALS_FN]: { ok: false, reason: '更新前尚未取得完整財報' } };
    const industry = industryByCode(peerGroups.groups[0].code ?? '')?.name ?? '玻纖紗/玻纖布';
    const gw = createFakeGateway({ tables: { stock_industry_map: [symbol, '9876'].map((s) => ({ symbol: s, industries: [industry], reviewed: true })) }, rpcs: rpcResponses, functions: responses, accessToken: `x.${btoa(JSON.stringify({ exp: 4102444800 }))}.y` });
    setCheckupGateway(gw);
    const holdings = [{ code: symbol, name: '測試持股', price: 100, value: 1000 }];
    const consumer = renderHook(() => ({ drawer: useValuationSnapshot(symbol), list: usePricedInList(holdings), extras: useStationExtras(symbol) }));
    await settle();
    expect(consumer.result.current.drawer.band?.rows[0].reason).toBe('更新前尚未取得完整財報');
    expect(consumer.result.current.list.items[0].pricedIn).toMatchObject({ level: 'unknown', reason: '更新前尚未取得完整財報' });
    expect(consumer.result.current.extras.peerRows[0].ps).toBe(3);
    responses[FUNDAMENTALS_FN] = { ok: false, reason: '新財報來源額度不足，保留待更新' };
    rpcResponses.valuation_peer_multiples = [{ symbol: '9876', trade_date: '2026-11-14', pe: 12, pb: 4, ps: 6 }];
    rpcResponses.forward_estimate_for = [{ eps: 8, period: '2027', eps_source: '公開財報', as_of: '2026-11-14' }];
    if (trigger === 'midnight' || trigger === 'hourly') {
      await act(async () => { await vi.advanceTimersByTimeAsync(trigger === 'midnight' ? 1000 : 3601000); });
    } else {
      act(() => {
        vi.setSystemTime(new Date('2026-11-14T17:00:01Z'));
        if (trigger === 'focus') window.dispatchEvent(new Event('focus'));
        else document.dispatchEvent(new Event('visibilitychange'));
      });
    }
    await settle();
    expect(consumer.result.current.drawer.band?.rows[0].reason).toBe('新財報來源額度不足，保留待更新');
    expect(consumer.result.current.list.items[0].pricedIn).toMatchObject({ level: 'unknown', reason: '新財報來源額度不足，保留待更新' });
    expect(consumer.result.current.extras.peerRows[0]).toMatchObject({ pe: 12, pb: 4, ps: 6 });
    expect(consumer.result.current.extras.forward?.eps).toBe(8);
  });
});