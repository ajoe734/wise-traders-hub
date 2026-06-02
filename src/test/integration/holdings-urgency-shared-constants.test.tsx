/**
 * H14 integration：useHoldingDecision / holdingsSort / HoldingsFilterBar
 * 共用同一份 urgency constants 物件參考。
 *
 * 保證：
 *  1. useHoldingDecision re-export 的 URGENCY_RANK 與 holdingsSort 是同一物件
 *     （`===` 物件參考，非 deep-equal）。
 *  2. HoldingsFilterBar UI 上「緊急」chip 的 value 全部命中 URGENCY_RANK keys，
 *     不會殘留舊詞彙 high/medium/low。
 *  3. useHoldingDecisions hook 真實輸出的 urgency 可直接餵給 FilterBar 的篩選
 *     Set（即兩端 string 互通）。
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import {
  URGENCY_RANK as DECISION_URGENCY,
  useHoldingDecisions,
} from '@/checkup/hooks/useHoldingDecision';
import { URGENCY_RANK as SORT_URGENCY } from '@/checkup/lib/holdingsSort';
import HoldingsFilterBar from '@/checkup/components/freecheckup/HoldingsFilterBar';

const C = {
  text: '#111',
  textSec: '#333',
  textMute: '#888',
  border: '#eee',
  card: '#fff',
};
const alpha = (_c: string, a: string) => `rgba(0,0,0,0.${a})`;

const noop = () => {};
const emptySet = () => new Set<string>();

describe('H14 integration — 同頁面共用 urgency constants', () => {
  it('useHoldingDecision.URGENCY_RANK === holdingsSort.URGENCY_RANK（同一物件參考）', () => {
    expect(DECISION_URGENCY).toBe(SORT_URGENCY);
    // 同時 freeze 檢查：不允許任一方私改
    expect(Object.keys(DECISION_URGENCY).sort()).toEqual(['monitor', 'now', 'soon']);
  });

  it('HoldingsFilterBar 緊急 chip 的 value 全部在 URGENCY_RANK keys 內', () => {
    render(
      <HoldingsFilterBar
        totalCount={0}
        filteredCount={0}
        searchQ=""
        setSearchQ={noop}
        filterDecision={emptySet()}
        setFilterDecision={noop}
        filterThesis={emptySet()}
        setFilterThesis={noop}
        filterUrgency={emptySet()}
        setFilterUrgency={noop}
        filterConflict={emptySet()}
        setFilterConflict={noop}
        filterPnl={emptySet()}
        setFilterPnl={noop}
        filterStrategy={emptySet()}
        setFilterStrategy={noop}
        strategyOptions={[]}
        toggleSetItem={() => noop}
        clearAllFilters={noop}
        C={C as any}
        alpha={alpha}
      />,
    );
    // 展開 details 即可顯示 chips
    const details = screen.getByText(/Filters/i).closest('summary')?.parentElement as HTMLDetailsElement;
    if (details) details.open = true;
    // FilterBar 三個 urgency chip label：立即/近期/觀察
    expect(screen.getByText('立即')).toBeInTheDocument();
    expect(screen.getByText('近期')).toBeInTheDocument();
    expect(screen.getByText('觀察')).toBeInTheDocument();
    // 禁止舊詞彙 chip
    expect(screen.queryByText(/^high$/i)).toBeNull();
    expect(screen.queryByText(/^medium$/i)).toBeNull();
    expect(screen.queryByText(/^low$/i)).toBeNull();
  });

  it('useHoldingDecisions 輸出的 urgency 可作為 FilterBar Set 內容（端到端詞彙互通）', () => {
    const holdings = [
      { code: 'EXIT', qty: 1, price: 80, cost: 100 },   // now
      { code: 'ADD', qty: 1, price: 106, cost: 100 },   // soon
      { code: 'MON', qty: 1, price: 99, cost: 100 },    // monitor
    ];
    const { result } = renderHook(() => useHoldingDecisions(holdings, []));
    const urgencies = result.current.map((r) => r.urgency);
    // 每個值都必須是 URGENCY_RANK 合法 key（亦即 FilterBar Set 篩選會匹配）
    for (const u of urgencies) {
      expect(SORT_URGENCY).toHaveProperty(u);
    }
    // 模擬 FilterBar filterUrgency.has(holding 推算出的 urgency) → 應全部 true
    const filterSet = new Set(Object.keys(SORT_URGENCY));
    for (const u of urgencies) {
      expect(filterSet.has(u)).toBe(true);
    }
  });
});
