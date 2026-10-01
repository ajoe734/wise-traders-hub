import { describe, expect, it, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createFakeGateway } from '@/checkup/lib/gateway/fakeGateway';
import { useValuationSnapshot, __resetFundamentalsCache, FUNDAMENTALS_FN, scenarioFromFundamentals } from '@/checkup/hooks/useValuationSnapshot';

const token = `x.${btoa(JSON.stringify({ exp: 4102444800 }))}.y`;
const rpc = { symbol: '3443', asOf: '2026-09-23', pe: 214.94, pb: 83.45, dividendYield: 0.24, history: { pe: [], pb: [], dividendYield: [] }, peers: [] };

describe('useValuationSnapshot 比率與財報情境解耦', () => {
  beforeEach(() => __resetFundamentalsCache());

  it('財報服務還沒回來時，比率已 ready；同一代碼兩個元件只發一次請求', async () => {
    let release: (v: any) => void = () => {};
    const slow = new Promise((r) => { release = r; });
    const gw = createFakeGateway({ rpcs: { valuation_snapshot: rpc }, accessToken: token, functions: {} });
    gw.invoke = (async (name: string, body: unknown) => { gw.calls.invoke.push({ name, body }); return slow; }) as any;
    const a = renderHook(() => useValuationSnapshot('3443', { injectedGateway: gw }));
    const b = renderHook(() => useValuationSnapshot('3443', { injectedGateway: gw }));
    await waitFor(() => expect(a.result.current.status).toBe('ready'));
    expect(a.result.current.view).not.toBeNull();
    expect(a.result.current.bandStatus).toBe('loading');
    release({ ok: true, asOf: '2026-10-01', rows: [] });
    await waitFor(() => expect(a.result.current.bandStatus).toBe('ready'));
    await waitFor(() => expect(b.result.current.bandStatus).toBe('ready'));
    expect(gw.calls.invoke.filter((c) => c.name === FUNDAMENTALS_FN)).toHaveLength(1);
  });

  it('沒有登入憑證時不呼叫財報服務', async () => {
    const gw = createFakeGateway({ rpcs: { valuation_snapshot: rpc }, accessToken: null });
    const h = renderHook(() => useValuationSnapshot('3443', { injectedGateway: gw }));
    await waitFor(() => expect(h.result.current.bandStatus).toBe('ready'));
    expect(gw.calls.invoke).toHaveLength(0);
    expect(h.result.current.band?.rows[0].reason).toMatch(/重新登入/);
  });

  it('官方名錄逾時時保留後備股數與特別股待確認狀態', () => {
    const basis = { value: 1, unit: 'TWD/share' as const, period: '2026Q2', publishedAt: '2026-10-01', source: '公開財報', kind: 'reported' as const, shareBasis: '後備股數' };
    const scenario = scenarioFromFundamentals({
      ok: true,
      asOf: '2026-10-01',
      official: { source: 'FinMind-TWSE', preferredUnknown: true },
      rows: (['pe', 'pb', 'ps'] as const).map((key) => ({ key, basis, multipleIssue: '樣本不足' })),
    }, null);
    expect(scenario.basisCount).toBe(3);
    expect(scenario.shareVerification).toEqual({ source: 'fallback', preferredUnknown: true });
  });
});
