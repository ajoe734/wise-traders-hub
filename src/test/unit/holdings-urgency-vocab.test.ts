/**
 * H14 回歸：urgency 詞彙統一憲法
 * - useHoldingDecision 輸出的 urgency 必須是 now/soon/monitor
 * - URGENCY_RANK 必須與 holdingsSort 同一物件（單一來源）
 * - holdingsSort.makeCompareByPriority 必須能正確排序這些值
 */
import { describe, it, expect } from 'vitest';
import {
  URGENCY_RANK as DECISION_URGENCY_RANK,
  useHoldingDecisions,
} from '@/checkup/hooks/useHoldingDecision';
import {
  URGENCY_RANK as SORT_URGENCY_RANK,
  makeCompareByPriority,
} from '@/checkup/lib/holdingsSort';
import { renderHook } from '@testing-library/react';

describe('H14 — urgency 詞彙統一', () => {
  it('URGENCY_RANK 是同一個物件參考（單一來源）', () => {
    expect(DECISION_URGENCY_RANK).toBe(SORT_URGENCY_RANK);
  });

  it('URGENCY_RANK 只包含 now/soon/monitor 三個 key', () => {
    expect(Object.keys(DECISION_URGENCY_RANK).sort()).toEqual(
      ['monitor', 'now', 'soon'],
    );
    // 禁止舊詞彙
    expect(DECISION_URGENCY_RANK).not.toHaveProperty('high');
    expect(DECISION_URGENCY_RANK).not.toHaveProperty('medium');
    expect(DECISION_URGENCY_RANK).not.toHaveProperty('low');
  });

  it('useHoldingDecisions 對 exit 場景輸出 urgency=now', () => {
    const holdings = [
      // 跌破 -8% → exit → now
      { code: 'A', qty: 1000, price: 80, cost: 100 },
      // -2% → hold → monitor
      { code: 'B', qty: 1000, price: 98, cost: 100 },
      // +25% → review (>=20%) → now（|pct|>=15）
      { code: 'C', qty: 1000, price: 125, cost: 100 },
      // +6% → add → soon
      { code: 'D', qty: 1000, price: 106, cost: 100 },
    ];
    const { result } = renderHook(() => useHoldingDecisions(holdings, []));
    const byCode = Object.fromEntries(result.current.map((r) => [r.holding.code, r.urgency]));
    expect(byCode.A).toBe('now');
    expect(byCode.B).toBe('monitor');
    expect(byCode.C).toBe('now');
    expect(byCode.D).toBe('soon');
    // 所有輸出都必須是合法 key
    for (const r of result.current) {
      expect(SORT_URGENCY_RANK).toHaveProperty(r.urgency);
    }
  });

  it('useHoldingDecisions 輸出可直接餵給 makeCompareByPriority 排序', () => {
    const holdings = [
      { code: 'MON', qty: 1, price: 99, cost: 100 },   // monitor
      { code: 'EXIT', qty: 1, price: 80, cost: 100 },  // now
      { code: 'ADD', qty: 1, price: 106, cost: 100 },  // soon
    ];
    const { result } = renderHook(() => useHoldingDecisions(holdings, []));
    const decisionsMap = Object.fromEntries(
      result.current.map((r) => [r.holding.code, { urgency: r.urgency, priority: 1 }]),
    );
    const cmp = makeCompareByPriority(decisionsMap);
    const sorted = holdings.map((h) => h.code).sort((a, b) =>
      cmp({ code: a }, { code: b }),
    );
    expect(sorted).toEqual(['EXIT', 'ADD', 'MON']);
  });
});
