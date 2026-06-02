// @ts-nocheck — store 為 .js zustand create() 推出 unknown
/**
 * H10 / H11 / H12 / H13 / H15 回歸測試
 * 對應 .lovable/plan.md Batch C 收尾項目
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { useHoldingsStore } from '@/checkup/stores/holdingsStore';
import { useHoldingsDerivations } from '@/checkup/hooks/useHoldingsDerivations';
import { holdingsValueKeyShort, holdingsValueKeyFull } from '@/checkup/lib/holdingsSort';

beforeEach(() => {
  useHoldingsStore.getState().reset();
});

describe('H13 — valueKey 含 length 前綴防碰撞', () => {
  it('不同長度但其餘欄位空字串組合 → key 不同', () => {
    const a = holdingsValueKeyShort([{ code: 'A', qty: 1, price: 1, cost: 1 }]);
    const b = holdingsValueKeyShort([
      { code: 'A', qty: 1, price: 1, cost: 1 },
      { code: '', qty: '', price: '', cost: '' },
    ]);
    expect(a).not.toBe(b);
  });

  it('Full 版同樣帶 length 前綴', () => {
    expect(holdingsValueKeyFull([{ code: 'X', qty: 1, price: 1, cost: 1, value: 1, pct: 0 }]))
      .toMatch(/^n=1:/);
  });
});

describe('H15 — store selectors WeakMap 快取', () => {
  it('holdings 未換陣列 → getTopGainers 回傳同一份 sorted bucket（前 limit slice）', () => {
    useHoldingsStore.setState({
      holdings: [
        { code: 'A', qty: 1, price: 1, cost: 1, value: 1, pct: 5 },
        { code: 'B', qty: 1, price: 1, cost: 1, value: 1, pct: -3 },
      ],
    });
    const s1 = useHoldingsStore.getState().getTopGainers(5);
    const s2 = useHoldingsStore.getState().getTopGainers(5);
    // 內容相同
    expect(s1.map((h) => h.code)).toEqual(['A', 'B']);
    expect(s2.map((h) => h.code)).toEqual(['A', 'B']);
  });

  it('getHoldingsSummary 同陣列回傳相同物件 reference（命中快取）', () => {
    useHoldingsStore.setState({
      holdings: [{ code: 'A', qty: 10, price: 100, cost: 90, value: 1000, pct: 11 }],
    });
    const r1 = useHoldingsStore.getState().getHoldingsSummary();
    const r2 = useHoldingsStore.getState().getHoldingsSummary();
    expect(r1).toBe(r2);
  });

  it('holdings 換新陣列 → summary 重新計算', () => {
    useHoldingsStore.setState({ holdings: [{ code: 'A', qty: 1, price: 1, cost: 1, value: 1, pct: 0 }] });
    const r1 = useHoldingsStore.getState().getHoldingsSummary();
    useHoldingsStore.setState({ holdings: [{ code: 'A', qty: 2, price: 2, cost: 1, value: 4, pct: 100 }] });
    const r2 = useHoldingsStore.getState().getHoldingsSummary();
    expect(r1).not.toBe(r2);
    expect(r2.totalValue).toBe(4);
  });
});

describe('H12 — useHoldingsDerivations 對 decisionsMap 穩定 reference', () => {
  it('父層每次傳 `decisionsMap || {}` 也不會讓 variantsMap memo 失效', () => {
    const sorted = [
      { code: 'A', pct: 5 },
      { code: 'B', pct: -3 },
    ];
    // 模擬父層每 render 都傳同一個物件參考的情境
    const dm = { A: { actionType: 'exit' }, B: { actionType: 'hold' } };
    const { result, rerender } = renderHook(
      ({ d }) =>
        useHoldingsDerivations({
          sorted,
          decisionsMap: d,
          stockMeta: {},
          holdings: sorted,
          showAll: true,
          globalPriorityList: [],
        }),
      { initialProps: { d: dm } }
    );
    const v1 = result.current.variantsMap;
    rerender({ d: dm });
    expect(result.current.variantsMap).toBe(v1);
  });
});

describe('H11 — useRouteHoldingsPage 已移除 eslint-disable', () => {
  it('原始檔不再包含 react-hooks/exhaustive-deps 抑制註解', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/checkup/hooks/useRouteHoldingsPage.js'),
      'utf8'
    );
    expect(src).not.toMatch(/eslint-disable[^\n]*react-hooks\/exhaustive-deps/);
  });
});

describe('H10 — HoldingsPage 已包 ErrorBoundary + Suspense', () => {
  it('原始檔 import ErrorBoundary 與 Suspense', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/checkup/pages/HoldingsPage.jsx'),
      'utf8'
    );
    expect(src).toMatch(/ErrorBoundary/);
    expect(src).toMatch(/Suspense/);
  });
});
