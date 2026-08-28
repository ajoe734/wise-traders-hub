/**
 * Stage D · chips 批次分塊與代號正規化（原 S3B-0 RED，v3 轉 GREEN 契約）
 *
 * 契約：
 *   1. 卡片渲染時最多發出 ceil(n/30) 個 bounded batch 請求，所有可見代號都必須涵蓋。
 *   2. 代號一律 trim + uppercase 後才做台股 canonical 驗證；`00637l` 與 `00637L` 去重為 1。
 *   3. 未通過 canonical 的代號（美股 / 空字串 / 注入字串）不打 API，
 *      只寫 `['tw-chips-batch-status', code] = {kind:'not_applicable'}`。
 *   4. 單批失敗只影響該批代號：其他批的 payload 保留、狀態 ok。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { StrictMode, createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const fetchChipsBatch = vi.fn();

vi.mock('@/checkup/lib/chipsRepository', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
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

import { useChipsBatch, chipsBatchStatusKey, chunkCodes, partitionCodes } from '@/checkup/hooks/useChipsBatch';
import { chipsQueryKey } from '@/checkup/hooks/useTwChipsDetail';
import type { BsrBatchStatusLike as BatchStatus } from '@/checkup/lib/bsrCanonicalCodes';

function makeQc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapperFor(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

function codesOf(n: number, start = 1101): string[] {
  return Array.from({ length: n }, (_, i) => String(start + i));
}

async function runBatch(qc: QueryClient, codes: string[]) {
  const { rerender } = renderHook(
    ({ c }: { c: string[] }) => useChipsBatch({ codes: c }),
    { wrapper: wrapperFor(qc), initialProps: { c: [] as string[] } },
  );
  rerender({ c: codes });
  await new Promise((r) => setTimeout(r, 60));
  return rerender;
}

describe('Stage D · chips 批次分塊', () => {
  beforeEach(() => {
    fetchChipsBatch.mockReset();
    fetchChipsBatch.mockImplementation(async (codes: string[]) => ({
      results: Object.fromEntries(codes.map((c) => [c, { stock_id: c }])),
      errors: {},
      count: codes.length,
      failed: 0,
      servedAt: new Date().toISOString(),
    }));
  });

  it('chunkCodes 純函式邊界：1/30/31/60/61 → 1/1/2/2/3', () => {
    expect(chunkCodes(codesOf(1)).length).toBe(1);
    expect(chunkCodes(codesOf(30)).length).toBe(1);
    expect(chunkCodes(codesOf(31)).length).toBe(2);
    expect(chunkCodes(codesOf(60)).length).toBe(2);
    expect(chunkCodes(codesOf(61)).length).toBe(3);
    for (const chunk of chunkCodes(codesOf(61))) expect(chunk.length).toBeLessThanOrEqual(30);
  });

  it('31 檔必須發出 2 個 bounded 請求且代號聯集完整', async () => {
    const qc = makeQc();
    const CODES = codesOf(31);
    await runBatch(qc, CODES);

    await waitFor(() => expect(fetchChipsBatch).toHaveBeenCalled());
    const calls = fetchChipsBatch.mock.calls;
    const sizes = calls.map((c) => (c[0] as string[]).length);
    expect(calls.length, `sizes=${sizes.join(',')}`).toBe(2);
    const union = new Set(calls.flatMap((c) => c[0] as string[]));
    expect(union.size).toBe(31);
    for (const s of sizes) expect(s).toBeLessThanOrEqual(30);
  });

  it('61 檔 → 3 個請求，每批 ≤30、無跨批重複', async () => {
    const qc = makeQc();
    await runBatch(qc, codesOf(61));
    const calls = fetchChipsBatch.mock.calls.map((c) => c[0] as string[]);
    expect(calls.length).toBe(3);
    const flat = calls.flat();
    expect(new Set(flat).size).toBe(flat.length);
    expect(new Set(flat).size).toBe(61);
  });

  it('normalization：00637l 與 00637L 去重為 1；00878 / 006208 為合法台股', () => {
    const { valid, rejected } = partitionCodes([
      '2330', '0050', '00878', '006208', '9105', '00637L', '00637l', ' 2330 ',
    ]);
    expect(valid).toEqual(['2330', '0050', '00878', '006208', '9105', '00637L']);
    expect(rejected).toEqual([]);
  });

  it('未通過 canonical 的代號不打 API，只寫 not_applicable', async () => {
    const qc = makeQc();
    const NA = ['ABC', 'ORCL', 'AMD', '', '   ', '<script>alert(1)</script>', '2330,2317', "2330' OR '1'='1"];
    await runBatch(qc, NA);

    expect(fetchChipsBatch).not.toHaveBeenCalled();
    for (const raw of ['ABC', 'ORCL', 'AMD', '<SCRIPT>ALERT(1)</SCRIPT>', '2330,2317', "2330' OR '1'='1"]) {
      const st = qc.getQueryData<BatchStatus>(chipsBatchStatusKey(raw.toUpperCase()));
      expect(st?.kind, `${raw} 應為 not_applicable`).toBe('not_applicable');
    }
  });

  it('partial chunk failure：chunk#2 失敗不影響 chunk#1 的 payload 與狀態', async () => {
    const qc = makeQc();
    const CODES = codesOf(31);
    fetchChipsBatch.mockImplementation(async (codes: string[]) => {
      if (codes.includes(CODES[30])) throw new Error('chunk 2 down');
      return {
        results: Object.fromEntries(codes.map((c) => [c, { stock_id: c }])),
        errors: {},
        count: codes.length,
        failed: 0,
        servedAt: new Date().toISOString(),
      };
    });
    await runBatch(qc, CODES);
    await new Promise((r) => setTimeout(r, 60));

    const sorted = [...CODES].sort();
    const okCode = sorted[0];
    const failCode = sorted[30];
    expect(
      qc.getQueryData<{ payload?: { stock_id?: string } }>(chipsQueryKey(okCode))?.payload?.stock_id,
    ).toBe(okCode);
    expect(qc.getQueryData<BatchStatus>(chipsBatchStatusKey(okCode))?.kind).toBe('ok');
    const failStatus = qc.getQueryData<BatchStatus>(chipsBatchStatusKey(failCode));
    expect(failStatus?.kind).toBe('error');
    expect(failStatus?.reason).toBe('chunk_failed');
  });
});

/**
 * v4.5 · initial-mount regression（Hosted Preview 真實紅燈）
 *
 * production 的 mount 一開始 codes 就非空、且此後永不改變；舊實作的 render-time
 * `keyRef = useRef(key)` 讓首次 effect 的 `keyRef.current === key` 成立而永久跳過批次，
 * 卡片就停在 data-bsr-state="loading"。既有測試都先 codes=[] 再 rerender，
 * 只證「代號後來改變」，測不到這條路徑。以下測試一律 **不 rerender**（除了
 * enabled toggle 案例），直接以非空 initialProps 掛載。
 */
describe('v4.5 · initial non-empty mount 必須啟動批次', () => {
  beforeEach(() => {
    fetchChipsBatch.mockReset();
    fetchChipsBatch.mockImplementation(async (codes: string[]) => ({
      results: Object.fromEntries(codes.map((c) => [c, { stock_id: c }])),
      errors: {},
      count: codes.length,
      failed: 0,
      servedAt: new Date().toISOString(),
    }));
  });

  it('initial codes=[2330]、完全不 rerender：exact 1 次 batch、status ok、payload 落地', async () => {
    const qc = makeQc();
    renderHook(() => useChipsBatch({ codes: ['2330'] }), { wrapper: wrapperFor(qc) });

    await waitFor(() => {
      expect(qc.getQueryData<BatchStatus>(chipsBatchStatusKey('2330'))?.kind).toBe('ok');
    });
    expect(fetchChipsBatch).toHaveBeenCalledTimes(1);
    expect(fetchChipsBatch.mock.calls[0][0]).toEqual(['2330']);
    expect(
      qc.getQueryData<{ payload?: { stock_id?: string } }>(chipsQueryKey('2330'))?.payload?.stock_id,
    ).toBe('2330');
  });

  it('initial 直接 31 檔、完全不 rerender：exact 2 批、sizes [30,1]、union exact 31', async () => {
    const qc = makeQc();
    const CODES = codesOf(31);
    renderHook(() => useChipsBatch({ codes: CODES }), { wrapper: wrapperFor(qc) });

    await waitFor(() => expect(fetchChipsBatch).toHaveBeenCalledTimes(2));
    const calls = fetchChipsBatch.mock.calls.map((c) => c[0] as string[]);
    expect(calls.map((c) => c.length)).toEqual([30, 1]);
    const flat = calls.flat();
    expect(flat.length).toBe(31);
    expect(new Set(flat).size).toBe(31);
    expect(new Set(flat)).toEqual(new Set(CODES));
  });

  it('initial codes 非空但 enabled=false：network exact 0；同 mount 切 enabled=true 後啟動', async () => {
    const qc = makeQc();
    const { rerender } = renderHook(
      ({ e }: { e: boolean }) => useChipsBatch({ codes: ['2330'], enabled: e }),
      { wrapper: wrapperFor(qc), initialProps: { e: false } },
    );
    await new Promise((r) => setTimeout(r, 60));
    expect(fetchChipsBatch).toHaveBeenCalledTimes(0);
    expect(qc.getQueryData<BatchStatus>(chipsBatchStatusKey('2330'))).toBeUndefined();

    rerender({ e: true });
    await waitFor(() => {
      expect(qc.getQueryData<BatchStatus>(chipsBatchStatusKey('2330'))?.kind).toBe('ok');
    });
    expect(fetchChipsBatch).toHaveBeenCalled();
    expect(
      qc.getQueryData<{ payload?: { stock_id?: string } }>(chipsQueryKey('2330'))?.payload?.stock_id,
    ).toBe('2330');
  });

  it('StrictMode initial codes=[2330]：effect replay 後最終 ok + payload，且不得留下 error', async () => {
    const qc = makeQc();
    const StrictWrapper = ({ children }: { children: ReactNode }) =>
      createElement(StrictMode, null, createElement(QueryClientProvider, { client: qc }, children));

    renderHook(() => useChipsBatch({ codes: ['2330'] }), { wrapper: StrictWrapper });

    await waitFor(() => {
      expect(qc.getQueryData<BatchStatus>(chipsBatchStatusKey('2330'))?.kind).toBe('ok');
    });
    await new Promise((r) => setTimeout(r, 60));
    const finalStatus = qc.getQueryData<BatchStatus>(chipsBatchStatusKey('2330'));
    expect(finalStatus?.kind).toBe('ok');
    expect(finalStatus?.kind).not.toBe('error');
    expect(
      qc.getQueryData<{ payload?: { stock_id?: string } }>(chipsQueryKey('2330'))?.payload?.stock_id,
    ).toBe('2330');
  });
});
