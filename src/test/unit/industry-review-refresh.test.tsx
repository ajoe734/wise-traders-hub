import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ rows: [] as object[] }));
vi.mock('@/checkup/lib/gateway', () => ({ getCheckupGateway: () => ({ db: { from: () => ({ select: () => ({ order: () => ({ range: async () => ({ data: state.rows, error: null }) }) }) }) } }) }));

import { useStockIndustryMap } from '@/checkup/hooks/useStockIndustryMap';
import { getAutoIndustryMap } from '@/checkup/lib/stockMetaMulti.js';

afterEach(() => { cleanup(); localStorage.clear(); });

describe('審核分類立即讀回', () => {
  it('進頁不沿用舊分類，返回分頁再讀回修正；空結果會清除撤銷的採用分類', async () => {
    localStorage.setItem('lf.checkup.stockIndustryMap.v4', JSON.stringify({ at: Date.now(), map: { '1815': { industries: ['PCB板廠'] } } }));
    state.rows = [{ symbol: '1815', industries: ['玻纖紗/玻纖布'], reviewed: true }];
    const hook = renderHook(() => useStockIndustryMap());
    await waitFor(() => expect(hook.result.current.count).toBe(1));
    expect(getAutoIndustryMap()['1815'].industries).toEqual(['玻纖紗/玻纖布']);
    state.rows = [{ symbol: '6274', industries: ['CCL銅箔基板'], reviewed: true }];
    act(() => window.dispatchEvent(new Event('stock-classification-updated')));
    await waitFor(() => expect(getAutoIndustryMap()['6274']?.industries).toEqual(['CCL銅箔基板']));
    expect(getAutoIndustryMap()['1815']).toBeUndefined();
    state.rows = [];
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(hook.result.current.count).toBe(0));
    expect(getAutoIndustryMap()).toEqual({});
  });
});