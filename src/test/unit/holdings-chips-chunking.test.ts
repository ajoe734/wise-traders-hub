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

import { useChipsBatch, chipsBatchStatusKey, chunkCodes, partitionCodes } from '@/checkup/hooks/useChipsBatch';
import { chipsQueryKey } from '@/checkup/hooks/useTwChipsDetail';

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
      const st = qc.getQueryData(chipsBatchStatusKey(raw.toUpperCase())) as any;
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
    expect((qc.getQueryData(chipsQueryKey(okCode)) as any)?.payload?.stock_id).toBe(okCode);
    expect((qc.getQueryData(chipsBatchStatusKey(okCode)) as any)?.kind).toBe('ok');
    const failStatus = qc.getQueryData(chipsBatchStatusKey(failCode)) as any;
    expect(failStatus?.kind).toBe('error');
    expect(failStatus?.reason).toBe('chunk_failed');
  });
});
