/**
 * G-Coverage（holdings audit 2026-05）
 * HoldingsPage 透過 useRouteHoldingsPage 計算 panelProps / tableProps，
 * 本測試確認 derived 值（totalVal / totalCost / winners / losers / integrityIssues）
 * 與 D-Perf-R6 valueKey 快取行為正確。
 *
 * 策略：直接測 hook（mock usePortfolioRouteContext + useBrainStore），
 * 避免拉起 react-router Outlet 與 zustand 完整初始化。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// hook 內含 Shell Bus deep-link（?expand=）消費，必須在 Router 下渲染。
const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(MemoryRouter, null, children);

vi.mock('@/checkup/stores/brainStore.js', () => {
  const state = { expandedStock: null, setExpandedStock: vi.fn() };
  return {
    useBrainStore: (selector: any) => selector(state),
  };
});

let contextValue: any = {};
vi.mock('@/checkup/pages/usePortfolioRouteContext.js', () => ({
  usePortfolioRouteContext: () => contextValue,
}));

import { useRouteHoldingsPage } from '@/checkup/hooks/useRouteHoldingsPage.js';

describe('useRouteHoldingsPage (HoldingsPage derived)', () => {
  beforeEach(() => {
    contextValue = {};
  });

  it('空持倉時 totalVal / totalCost = 0，winners/losers 為空', () => {
    contextValue = { holdings: [] };
    const { result } = renderHook(() => useRouteHoldingsPage(), { wrapper });
    expect(result.current.panelProps.totalVal).toBe(0);
    expect(result.current.panelProps.totalCost).toBe(0);
    expect(result.current.panelProps.winners).toEqual([]);
    expect(result.current.panelProps.losers).toEqual([]);
    expect(result.current.panelProps.holdingsIntegrityIssues).toEqual([]);
  });

  it('totalVal = Σ value；totalCost = Σ cost × qty', () => {
    contextValue = {
      holdings: [
        { code: 'A', qty: 10, cost: 100, value: 1500, pct: 50 },
        { code: 'B', qty: 5, cost: 200, value: 800, pct: -20 },
      ],
    };
    const { result } = renderHook(() => useRouteHoldingsPage(), { wrapper });
    expect(result.current.panelProps.totalVal).toBe(2300);
    expect(result.current.panelProps.totalCost).toBe(10 * 100 + 5 * 200);
  });

  it('winners 為 pct>0 並依 pct 降序；losers 為 pct<0 並依 pct 升序', () => {
    contextValue = {
      holdings: [
        { code: 'X', qty: 1, cost: 10, value: 12, pct: 20 },
        { code: 'Y', qty: 1, cost: 10, value: 18, pct: 80 },
        { code: 'Z', qty: 1, cost: 10, value: 5, pct: -50 },
        { code: 'W', qty: 1, cost: 10, value: 8, pct: -20 },
        { code: 'N', qty: 1, cost: 10, value: 10, pct: 0 }, // 0 不算 winner 也不算 loser
      ],
    };
    const { result } = renderHook(() => useRouteHoldingsPage(), { wrapper });
    expect(result.current.panelProps.winners.map((h: any) => h.code)).toEqual(['Y', 'X']);
    expect(result.current.panelProps.losers.map((h: any) => h.code)).toEqual(['Z', 'W']);
  });

  it('integrityIssue=missing-price 進入 holdingsIntegrityIssues', () => {
    contextValue = {
      holdings: [
        { code: 'A', qty: 1, cost: 10, value: 10, pct: 0, integrityIssue: 'missing-price' },
        { code: 'B', qty: 1, cost: 10, value: 10, pct: 0 },
      ],
    };
    const { result } = renderHook(() => useRouteHoldingsPage(), { wrapper });
    expect(result.current.panelProps.holdingsIntegrityIssues.map((h: any) => h.code)).toEqual(['A']);
  });

  it('D-Perf-R6: holdings 值未變 → panelProps.holdings 維持同一 reference（valueKey 命中快取）', () => {
    const list = [{ code: 'A', qty: 10, cost: 100, value: 1500, pct: 50 }];
    contextValue = { holdings: list };
    const { result, rerender } = renderHook(() => useRouteHoldingsPage(), { wrapper });
    const first = result.current.panelProps.holdings;
    // 模擬 store push 一個值相同但 reference 不同的新陣列
    contextValue = { holdings: [{ ...list[0] }] };
    rerender();
    const second = result.current.panelProps.holdings;
    expect(second).toBe(first);
  });

  it('holdings price 改變 → reference 改變（快取失效）', () => {
    contextValue = { holdings: [{ code: 'A', qty: 10, cost: 100, value: 1500, pct: 50 }] };
    const { result, rerender } = renderHook(() => useRouteHoldingsPage(), { wrapper });
    const first = result.current.panelProps.holdings;
    contextValue = { holdings: [{ code: 'A', qty: 10, cost: 100, value: 1600, pct: 60 }] };
    rerender();
    expect(result.current.panelProps.holdings).not.toBe(first);
    expect(result.current.panelProps.totalVal).toBe(1600);
  });

  it('tableProps 暴露 expandedStock / setExpandedStock / 三個 updater', () => {
    contextValue = {
      holdings: [],
      updateTargetPrice: vi.fn(),
      updateAlert: vi.fn(),
      updateReversal: vi.fn(),
    };
    const { result } = renderHook(() => useRouteHoldingsPage(), { wrapper });
    expect(result.current.tableProps).toHaveProperty('expandedStock');
    expect(result.current.tableProps).toHaveProperty('setExpandedStock');
    expect(typeof result.current.tableProps.onUpdateTarget).toBe('function');
    expect(typeof result.current.tableProps.onUpdateAlert).toBe('function');
  });
});
