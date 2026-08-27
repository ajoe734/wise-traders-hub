/**
 * Stage D · useChipsBatch 的 run identity（race 防護）
 *
 * 契約（Plan v3 §D）：
 *   - 每輪 run 有遞增 runId；chunk 回覆寫入前先比對 runId。
 *   - run1 尚未回覆時代號變更觸發 run2；run1 晚回覆一律丟棄，
 *     不得覆蓋 run2 的 payload 或狀態。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const fetchChipsBatch = vi.fn();
const prefetchChipsPayload = vi.fn();

vi.mock('@/checkup/lib/chipsRepository', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    fetchChipsBatch: (...args: unknown[]) => fetchChipsBatch(...args),
    prefetchChipsPayload: (...args: unknown[]) => prefetchChipsPayload(...args),
  };
});
vi.mock('@/checkup/hooks/useSparklines', () => ({ prefetchSparkline: vi.fn() }));
vi.mock('@/checkup/contexts/CheckupModeContext', () => ({
  useCheckupMode: () => ({ isDemo: false }),
}));

import { useChipsBatch, chipsBatchStatusKey } from '@/checkup/hooks/useChipsBatch';
import { chipsQueryKey } from '@/checkup/hooks/useTwChipsDetail';
import type { BsrBatchStatusLike as BatchStatus } from '@/checkup/lib/bsrCanonicalCodes';

describe('Stage D · chips batch race', () => {
  beforeEach(() => fetchChipsBatch.mockReset());

  it('run1 晚回覆不得覆蓋 run2 的狀態與 payload', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children);

    let releaseRun1: (v: unknown) => void = () => {};
    const run1 = new Promise<unknown>((res) => { releaseRun1 = res; });

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

    const run2Status = qc.getQueryData<BatchStatus>(chipsBatchStatusKey('2330'));
    expect(run2Status?.kind).toBe('ok');
    const run2Run = run2Status?.runId;

    releaseRun1(null);                  // run1 晚回覆
    await new Promise((r) => setTimeout(r, 40));

    // run1 的 payload 不得寫入
    expect(qc.getQueryData(chipsQueryKey('1101'))).toBeUndefined();
    // run1 的狀態停留在它自己那輪的 pending，不得變成 ok，也不得覆蓋 run2
    const staleStatus = qc.getQueryData<BatchStatus>(chipsBatchStatusKey('1101'));
    expect(staleStatus?.kind).toBe('pending');
    expect(staleStatus?.runId as number).toBeLessThan(run2Run as number);
    const after = qc.getQueryData<BatchStatus>(chipsBatchStatusKey('2330'));
    expect(after?.kind).toBe('ok');
    expect(after?.runId).toBe(run2Run);
  });
});

/* ── v4.2 新增：cross-race（batch × manual、manual × manual）────────────────
 * 契約（PLAN_V4.2 §B5）：
 *   - 每個 code 有 ownership token（seqRef）；batch 與 manual 共用同一條 token 線。
 *   - newer manual 接管後，較舊 batch 的成功／失敗結果都不得寫入 payload/status，
 *     也不得從 prefetched 移除 manual 已加入的 entry（禁止 setPrefetched(new Set(done)) 全量覆蓋）。
 *   - manual1 → manual2：只有 manual2 的結果算數。
 */
describe('Stage D · cross-race ownership token', () => {
  beforeEach(() => {
    fetchChipsBatch.mockReset();
    prefetchChipsPayload.mockReset();
  });

  function mount() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children);
    const hook = renderHook(
      ({ c }: { c: string[] }) => useChipsBatch({ codes: c }),
      { wrapper, initialProps: { c: [] as string[] } },
    );
    return { qc, ...hook };
  }

  it('deferred batch × newer manual：manual 勝出，batch 收尾不得抹掉 manual', async () => {
    const { qc, result, rerender } = mount();
    let releaseBatch: (v: unknown) => void = () => {};
    const batchGate = new Promise((res) => { releaseBatch = res; });

    fetchChipsBatch.mockImplementation(async () => {
      await batchGate;
      return { results: { '2330': { stock_id: '2330', _from: 'batch' } }, errors: {}, count: 1, failed: 0, servedAt: '' };
    });
    prefetchChipsPayload.mockImplementation(async () => ({
      payload: { stock_id: '2330', _from: 'manual' }, stampVer: null, bytes: 0, durationMs: 0,
    }));

    rerender({ c: ['2330'] });               // batch run（掛住）
    await new Promise((r) => setTimeout(r, 20));
    await act(async () => { await result.current.prefetch('2330'); });   // newer manual 接管

    expect(qc.getQueryData<{ payload?: { _from?: string } }>(chipsQueryKey('2330'))?.payload?._from).toBe('manual');
    expect(result.current.prefetched.has('2330')).toBe(true);

    releaseBatch(null);                      // 舊 batch 晚回覆
    await new Promise((r) => setTimeout(r, 40));

    expect(qc.getQueryData<{ payload?: { _from?: string } }>(chipsQueryKey('2330'))?.payload?._from).toBe('manual');
    expect(qc.getQueryData<BatchStatus>(chipsBatchStatusKey('2330'))?.kind).not.toBe('error');
    expect(result.current.prefetched.has('2330'), 'batch 收尾全量覆蓋會抹掉 manual').toBe(true);
  });

  it('manual1 → manual2：manual1 晚回覆不得覆蓋 manual2', async () => {
    const { qc, result } = mount();
    let release1: (v: unknown) => void = () => {};
    const gate1 = new Promise((res) => { release1 = res; });
    let call = 0;
    prefetchChipsPayload.mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        await gate1;
        return { payload: { stock_id: '2330', _from: 'manual1' }, stampVer: null, bytes: 0, durationMs: 0 };
      }
      return { payload: { stock_id: '2330', _from: 'manual2' }, stampVer: null, bytes: 0, durationMs: 0 };
    });

    let p1: Promise<unknown> = Promise.resolve();
    await act(async () => { p1 = result.current.prefetch('2330'); await Promise.resolve(); });
    await act(async () => { await result.current.prefetch('2330'); });   // manual2 先完成

    expect(qc.getQueryData<{ payload?: { _from?: string } }>(chipsQueryKey('2330'))?.payload?._from).toBe('manual2');

    await act(async () => { release1(null); await p1; });
    await new Promise((r) => setTimeout(r, 20));

    expect(qc.getQueryData<{ payload?: { _from?: string } }>(chipsQueryKey('2330'))?.payload?._from).toBe('manual2');
    expect(result.current.prefetched.has('2330')).toBe(true);
  });
});
