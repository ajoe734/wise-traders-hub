// Grouping invariant tests for useHoldingsDerivations.
// 驗證：topActionableItems + remainingItems === uniqueHoldings（互斥且完整）。
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useHoldingsDerivations } from '../useHoldingsDerivations.js';

function makeHolding(code, extras = {}) {
  return { code, name: `名 ${code}`, market: 'TW', pct: 0, ...extras };
}
function decisions(map) { return map; }

describe('useHoldingsDerivations grouping invariant', () => {
  it('20 holdings with 4 EXIT/REVIEW → top 3 + remaining 17，第 4 檔在 remaining', () => {
    const H = Array.from({ length: 20 }, (_, i) => makeHolding(String(1001 + i)));
    // 4 檔 EXIT/REVIEW
    const dm = decisions({
      '1001': { actionType: 'exit', actionText: '停損 A', priority: 1 },
      '1002': { actionType: 'review', actionText: '複審 B', priority: 2 },
      '1003': { actionType: 'exit', actionText: '停損 C', priority: 3 },
      '1004': { actionType: 'exit', actionText: '停損 D', priority: 4 },
    });
    const { result } = renderHook(() =>
      useHoldingsDerivations({
        sorted: H,
        decisionsMap: dm,
        stockMeta: {},
        holdings: H,
        showAll: true,
        globalPriorityList: [H[0], H[1], H[2], H[3]], // 前 4 檔 priority ≤ 4
      })
    );

    expect(result.current.uniqueHoldings.length).toBe(20);
    expect(result.current.actionPriorityItems.length).toBe(3);
    expect(result.current.remainingItems.length).toBe(17);

    // invariant
    expect(
      result.current.actionPriorityItems.length + result.current.remainingItems.length
    ).toBe(result.current.uniqueHoldings.length);

    // 第 4 檔 EXIT (1004) 必須出現在 remainingItems
    const restCodes = result.current.remainingItems.map((h) => h.code);
    expect(restCodes).toContain('1004');
  });

  it('相同 code 不同 market → 視為兩檔（uniqKey 用 market:code）', () => {
    const tw = { code: '2330', name: 'TSMC', market: 'TW' };
    const us = { code: '2330', name: 'Other', market: 'US' };
    const H = [tw, us];
    const { result } = renderHook(() =>
      useHoldingsDerivations({
        sorted: H, decisionsMap: {}, stockMeta: {}, holdings: H,
        showAll: true, globalPriorityList: [],
      })
    );
    expect(result.current.uniqueHoldings.length).toBe(2);
    expect(result.current.remainingItems.length).toBe(2);
  });

  it('完全重複的 holding row → 去重為一檔', () => {
    const h = makeHolding('2330');
    const H = [h, h, { ...h }];
    const { result } = renderHook(() =>
      useHoldingsDerivations({
        sorted: H, decisionsMap: {}, stockMeta: {}, holdings: H,
        showAll: true, globalPriorityList: [],
      })
    );
    expect(result.current.uniqueHoldings.length).toBe(1);
  });

  it('全部 hold → top 為空、remaining = 全部', () => {
    const H = Array.from({ length: 5 }, (_, i) => makeHolding(String(2001 + i)));
    const { result } = renderHook(() =>
      useHoldingsDerivations({
        sorted: H, decisionsMap: {}, stockMeta: {}, holdings: H,
        showAll: true, globalPriorityList: [],
      })
    );
    expect(result.current.actionPriorityItems.length).toBe(0);
    expect(result.current.remainingItems.length).toBe(5);
  });
});
