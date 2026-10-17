import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeGateway } from '@/checkup/lib/gateway/fakeGateway';
import { loadFundamentals, __resetFundamentalsCache, FUNDAMENTALS_FN } from '@/checkup/hooks/useValuationSnapshot';

describe('財報更新公開快取邊界', () => {
  beforeEach(() => { vi.useFakeTimers(); __resetFundamentalsCache(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

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
});