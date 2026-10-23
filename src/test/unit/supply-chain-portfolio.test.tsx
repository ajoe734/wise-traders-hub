import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePortfolioValuation } from '@/checkup/hooks/usePortfolioValuation';
import { computePortfolioValuation } from '@/checkup/lib/valuationRulers';

describe('投組產業鏈同業公開接縫', () => {
  it('舊RPC混入CCL及PCB時，只以玻纖同業計算並立即套用分類修正', async () => {
    const peers = ['5340', '5475', 'glass3', '6274', 'pcb'].map((symbol, i) => ({ symbol, pe: i < 3 ? 10 : 1000, pb: i < 3 ? 2 : 100, dividendYield: i < 3 ? 3 : 0 }));
    const rpc = vi.fn(async () => [{ symbol: '1815', asOf: '2026-10-22', pe: 20, pb: 4, dividendYield: 2, peers }]);
    const gateway = { rpc } as any;
    const holdings = [{ code: '1815', value: 1000 }];
    const map = { '1815': { industries: ['玻纖紗/玻纖布'] }, '5340': { industries: ['玻纖紗/玻纖布'] }, '5475': { industries: ['玻纖紗/玻纖布'] }, glass3: { industries: ['玻纖紗/玻纖布'] }, '6274': { industries: ['CCL銅箔基板', '玻纖紗/玻纖布'] }, pcb: { industries: ['PCB板廠'] } };
    const { result, rerender } = renderHook(({ classifications }) => usePortfolioValuation(holdings, { injectedGateway: gateway, injectedIndustryMap: classifications, refreshMs: 0 }), { initialProps: { classifications: map } });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.result).toEqual(computePortfolioValuation([{ symbol: '1815', weight: 1000, pe: 20, pb: 4, dividendYield: 2, peers: peers.slice(0, 3) }]));
    rerender({ classifications: { ...map, glass3: { industries: ['CCL銅箔基板'] } } });
    await waitFor(() => expect(result.current.result).toEqual(computePortfolioValuation([{ symbol: '1815', weight: 1000, pe: 20, pb: 4, dividendYield: 2, peers: peers.slice(0, 2) }])));
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});