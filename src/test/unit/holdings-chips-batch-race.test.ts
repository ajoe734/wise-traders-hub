/**
 * Stage D · useChipsBatch 的 run identity（race 防護）
 *
 * 契約（Plan v3 §D）：
 *   - 每輪 run 有遞增 runId；chunk 回覆寫入前先比對 runId。
 *   - run1 尚未回覆時代號變更觸發 run2；run1 晚回覆一律丟棄，
 *     不得覆蓋 run2 的 payload 或狀態。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const fetchChipsBatch = vi.fn();

vi.mock('@/checkup/lib/chipsRepository', async (orig) => {
  const actual = await (orig() as Promise<any>);
  return {
    ...actual,
    fetchChipsBatch: (...args: unknown[]) => fetchChipsBatch(...args),
    prefetchChipsPayload: vi.fn(),
  };
});
vi.mock('@/checkup/hooks/useSparklines', () => ({ prefetchSparkline: vi.fn() }));
vi.mock('@/checkup/contexts/CheckupModeContext', () => ({
  useCheckupMode: () => ({ isDemo: false }),
}));

import { useChipsBatch, chipsBatchStatusKey } from '@/checkup/hooks/useChipsBatch';
import { chipsQueryKey } from '@/checkup/hooks/useTwChipsDetail';

describe('Stage D · chips batch race', () => {
  beforeEach(() => fetchChipsBatch.mockReset());

  it('run1 晚回覆不得覆蓋 run2 的狀態與 payload', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children);

    let releaseRun1: (v: any) => void = () => {};
    const run1 = new Promise((res) => { releaseRun1 = res; });

    fetchChipsBatch.mockImplementation(async (codes?: string[]) => {
      const ids = Array.isArray(codes) ? codes : [];
      if (ids.includes('1101')) {
        await run1;
        return {
          results: { '1101': { stock_id: '1101', _stale_run: true } },
          errors: {}, count: 1, failed: 0, servedAt: '',
        };
      }
      return {
        results: Object.fromEntries(ids.map((c) => [c, { stock_id: c }])),
        errors: {}, count: ids.length, failed: 0, servedAt: '',
      };
    });

    const { rerender } = renderHook(
      ({ c }: { c: string[] }) => useChipsBatch({ codes: c }),
      { wrapper, initialProps: { c: [] as string[] } },
    );

    rerender({ c: ['1101'] });          // run1（掛住）
    await new Promise((r) => setTimeout(r, 20));
    rerender({ c: ['2330'] });          // run2
    await new Promise((r) => setTimeout(r, 40));

    const run2Status = qc.getQueryData(chipsBatchStatusKey('2330')) as any;
    expect(run2Status?.kind).toBe('ok');
    const run2Run = run2Status?.runId;

    releaseRun1(null);                  // run1 晚回覆
    await new Promise((r) => setTimeout(r, 40));

    // run1 的 payload 不得寫入
    expect(qc.getQueryData(chipsQueryKey('1101'))).toBeUndefined();
    // run1 的狀態停留在它自己那輪的 pending，不得變成 ok，也不得覆蓋 run2
    const staleStatus = qc.getQueryData(chipsBatchStatusKey('1101')) as any;
    expect(staleStatus?.kind).toBe('pending');
    expect(staleStatus?.runId).toBeLessThan(run2Run);
    const after = qc.getQueryData(chipsBatchStatusKey('2330')) as any;
    expect(after?.kind).toBe('ok');
    expect(after?.runId).toBe(run2Run);
  });
});
