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
import { readFileSync } from 'node:fs';
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

/**
 * Stage 1 §E · chunks 由 Promise.all 改為 visible-order sequential await
 *
 * 目的：31 檔時不再同時開兩個 Edge invocation（兩組 semaphore(6) → 整頁 DB 併發 12）。
 * 契約不得退化：exact [30,1]、union/order 相同、每 chunk failure 隔離、
 * cleanup／新 run 後第二批 network exact 0。
 */
describe('Stage 1 §E · sequential chunks', () => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  }
  const okRes = (codes: string[]) => ({
    results: Object.fromEntries(codes.map((c) => [c, { stock_id: c }])),
    errors: {},
    count: codes.length,
    failed: 0,
    servedAt: new Date().toISOString(),
  });

  beforeEach(() => {
    fetchChipsBatch.mockReset();
  });

  it('31 檔：第一 POST body=30；第一 promise 未 settle 前第二 POST count=0；settle 後第二 body=1，union/order exact 31', async () => {
    const qc = makeQc();
    const CODES = codesOf(31);
    const d1 = deferred<ReturnType<typeof okRes>>();
    fetchChipsBatch.mockImplementationOnce(() => d1.promise);
    fetchChipsBatch.mockImplementation(async (codes: string[]) => okRes(codes));

    renderHook(() => useChipsBatch({ codes: CODES }), { wrapper: wrapperFor(qc) });

    await waitFor(() => expect(fetchChipsBatch).toHaveBeenCalledTimes(1));
    expect((fetchChipsBatch.mock.calls[0][0] as string[]).length).toBe(30);
    // 第一批仍 pending 期間，第二批不得發出。
    await new Promise((r) => setTimeout(r, 60));
    expect(fetchChipsBatch).toHaveBeenCalledTimes(1);

    d1.resolve(okRes(fetchChipsBatch.mock.calls[0][0] as string[]));
    await waitFor(() => expect(fetchChipsBatch).toHaveBeenCalledTimes(2));

    const bodies = fetchChipsBatch.mock.calls.map((c) => c[0] as string[]);
    expect(bodies.map((b) => b.length)).toEqual([30, 1]);
    const flat = bodies.flat();
    expect(flat.length).toBe(31);
    expect(new Set(flat).size).toBe(31);
    // 送出順序 = 可見順序
    expect(flat).toEqual(CODES);
  });

  it('第一 chunk reject 後第二 chunk 仍執行，且兩批狀態互相隔離', async () => {
    const qc = makeQc();
    const CODES = codesOf(31);
    fetchChipsBatch.mockImplementationOnce(async () => { throw new Error('chunk 1 down'); });
    fetchChipsBatch.mockImplementation(async (codes: string[]) => okRes(codes));

    renderHook(() => useChipsBatch({ codes: CODES }), { wrapper: wrapperFor(qc) });

    await waitFor(() => expect(fetchChipsBatch).toHaveBeenCalledTimes(2));
    const bodies = fetchChipsBatch.mock.calls.map((c) => c[0] as string[]);
    expect(bodies.map((b) => b.length)).toEqual([30, 1]);

    await waitFor(() => {
      expect(qc.getQueryData<BatchStatus>(chipsBatchStatusKey(CODES[30]))?.kind).toBe('ok');
    });
    const failStatus = qc.getQueryData<BatchStatus>(chipsBatchStatusKey(CODES[0]));
    expect(failStatus?.kind).toBe('error');
    expect(failStatus?.reason).toBe('chunk_failed');
    expect(qc.getQueryData(chipsQueryKey(CODES[0]))).toBeUndefined();
    expect(
      qc.getQueryData<{ payload?: { stock_id?: string } }>(chipsQueryKey(CODES[30]))?.payload?.stock_id,
    ).toBe(CODES[30]);
  });

  it('第一 chunk pending 時 unmount：之後第二 POST exact 0，且舊 run 不寫 error', async () => {
    const qc = makeQc();
    const CODES = codesOf(31);
    const d1 = deferred<ReturnType<typeof okRes>>();
    fetchChipsBatch.mockImplementationOnce(() => d1.promise);
    fetchChipsBatch.mockImplementation(async (codes: string[]) => okRes(codes));

    const { unmount } = renderHook(() => useChipsBatch({ codes: CODES }), { wrapper: wrapperFor(qc) });
    await waitFor(() => expect(fetchChipsBatch).toHaveBeenCalledTimes(1));

    unmount();
    d1.reject(new Error('aborted'));
    await new Promise((r) => setTimeout(r, 80));

    expect(fetchChipsBatch).toHaveBeenCalledTimes(1);
    for (const code of [CODES[0], CODES[29], CODES[30]]) {
      expect(qc.getQueryData<BatchStatus>(chipsBatchStatusKey(code))?.kind).not.toBe('error');
    }
  });

  it('第一 chunk pending 時 codes 改變（new run）：舊 run 的第二批不得發出', async () => {
    const qc = makeQc();
    const CODES = codesOf(31);
    const d1 = deferred<ReturnType<typeof okRes>>();
    fetchChipsBatch.mockImplementationOnce(() => d1.promise);
    fetchChipsBatch.mockImplementation(async (codes: string[]) => okRes(codes));

    const { rerender } = renderHook(
      ({ c }: { c: string[] }) => useChipsBatch({ codes: c }),
      { wrapper: wrapperFor(qc), initialProps: { c: CODES } },
    );
    await waitFor(() => expect(fetchChipsBatch).toHaveBeenCalledTimes(1));

    rerender({ c: ['2330'] });
    await waitFor(() => expect(fetchChipsBatch).toHaveBeenCalledTimes(2));
    // 第 2 次呼叫必須是新 run 的單一代號，不是舊 run 的第二個 chunk。
    expect(fetchChipsBatch.mock.calls[1][0]).toEqual(['2330']);

    d1.reject(new Error('aborted'));
    await new Promise((r) => setTimeout(r, 80));
    expect(fetchChipsBatch).toHaveBeenCalledTimes(2);
    expect(qc.getQueryData<BatchStatus>(chipsBatchStatusKey(CODES[0]))?.kind).not.toBe('error');
  });
});

/**
 * Stage 1 · Edge source contract（**static source assertions**，非 runtime）
 *
 * 明說限制：`tw-chips-detail-v2/index.ts` 用 Deno / jsr / npm specifier，vitest 無法 import 執行，
 * 因此以下是對 source 文字的靜態契約檢查，不冒充 runtime 行為驗證。
 * runtime 行為（semaphore 實際併發、bulk 次數）必須以 Hosted 實測補上。
 */
describe('Stage 1 · Edge source contract（static only）', () => {
  const src = readFileSync('supabase/functions/tw-chips-detail-v2/index.ts', 'utf8');

  it('semaphore hard max = 6 且 code concurrency = 2', () => {
    expect(src).toMatch(/const MAX_DB_CONCURRENCY = 6;/);
    expect(src).toMatch(/const CODE_CONCURRENCY = 2;/);
    expect(src).toMatch(/createSemaphore\(MAX_DB_CONCURRENCY\)/);
    expect(src).toMatch(/runBatchPhases\(batchIds, \{/);
    expect(src).toMatch(/concurrency: CODE_CONCURRENCY,/);
    // 不得有第二個 semaphore 上限來源
    expect(src.match(/createSemaphore\(/g)?.length).toBe(2); // 定義 + 唯一呼叫
  });


  it('batch ctx 只建立於 batch path；single GET 保留 ctx=null fallback', () => {
    expect(src).toMatch(/buildChipsPayload\(supa, singleId, sem, null\)/);
    const ctxIdx = src.indexOf('await buildBatchCtx(supa, sem, batchIds)');
    const singleIdx = src.indexOf('if (!isBatch && singleId)');
    expect(ctxIdx).toBeGreaterThan(-1);
    expect(singleIdx).toBeGreaterThan(-1);
    expect(ctxIdx).toBeGreaterThan(singleIdx);
    // batch ctx 只建立一次
    expect(src.match(/buildBatchCtx\(supa, sem, batchIds\)/g)?.length).toBe(1);
  });

  it('每個 bulk 查詢最多一次，且六類都存在', () => {
    for (const t of [
      '"tw_bsr_sync_queue"',
      '"tw_bsr_fetch_failures"',
      '"tw_bsr_sync_config"',
      '"tw_bsr_upstream_probe"',
      '"data_source_health"',
    ]) {
      expect(src.includes(t)).toBe(true);
    }
    const ctxBlock = src.slice(
      src.indexOf('export async function buildBatchCtx'),
      src.indexOf('// 單股 payload 建構'),
    );
    // bulk phase 恰 6 條，且全部經 sem()
    expect(ctxBlock.match(/sem\(\(\) =>/g)?.length).toBe(6);
  });

  it('仍是 read-only：無任何 write / enqueue / provider fetch', () => {
    expect(src).not.toMatch(/\.insert\(|\.upsert\(|\.update\(|\.delete\(/);
    // RPC allowlist：只有兩支唯讀 RPC，沒有任何 writer / rebuild / enqueue RPC。
    const rpcNames = Array.from(src.matchAll(/\.rpc\(\s*["']([a-z0-9_]+)["']/gi)).map((m) => m[1]).sort();
    expect(Array.from(new Set(rpcNames))).toEqual(['get_bsr_daily_series', 'tw_bsr_eligibility']);
    // 完全不對外抓資料（provider fetch = 0）。
    expect(src).not.toMatch(/\bfetch\(/);
    expect(src).not.toMatch(/https?:\/\/(?!jsr\.io)/);
  });

  it('response schema keys 不變', () => {
    for (const k of ['results,', 'errors,', 'count:', 'failed:', 'served_at:']) {
      expect(src.includes(k)).toBe(true);
    }
    expect(src).toMatch(/const MAX_BATCH = 30;/);
  });
});

/**
 * STAGE1_HARD_MAX · runBatchPhases 三階段排程（**executable**，非只讀字串）
 *
 * index.ts 是 Deno 模組（Deno.serve top-level + jsr/npm specifier），vitest 不能整檔 import。
 * 因此本組測試把 index.ts 內以 `--- BEGIN runBatchPhases ---` 標記的 **自足、無型別註記 slice**
 * 直接 new Function 執行，證明真的三階段、峰值不重疊，而不是只比對常數字串。
 */
describe('STAGE1_HARD_MAX · runBatchPhases（executable slice）', () => {
  const src = readFileSync('supabase/functions/tw-chips-detail-v2/index.ts', 'utf8');
  const BEGIN = '// --- BEGIN runBatchPhases';
  const END = '// --- END runBatchPhases ---';

  function loadRunBatchPhases() {
    const b = src.indexOf(BEGIN);
    const e = src.indexOf(END);
    expect(b, 'BEGIN marker 必須存在').toBeGreaterThan(-1);
    expect(e, 'END marker 必須存在').toBeGreaterThan(b);
    const slice = src.slice(src.indexOf('\n', b) + 1, e).trim().replace(/;$/, '');
    // slice 必須是純 JS（無型別註記），否則這裡會直接語法錯誤。
    return new Function(`return (${slice});`)() as (
      ids: string[],
      deps: {
        concurrency: number;
        computeStamp: (id: string) => Promise<string>;
        buildWithStamp: (id: string, stampVer: string) => Promise<unknown>;
      },
    ) => Promise<Array<{ ok: boolean; id: string; value?: unknown; error?: string }>>;
  }


  const ids10 = codesOf(10);

  it('payload phase 在最後一個 stamp settled 前 exact 0 start', async () => {
    const runBatchPhases = loadRunBatchPhases();
    const events: string[] = [];
    let stampSettled = 0;
    let payloadStartsBeforeAllStamps = 0;

    await runBatchPhases(ids10, {
      concurrency: 2,
      computeStamp: async (id) => {
        await new Promise((r) => setTimeout(r, 5));
        stampSettled += 1;
        events.push(`stamp:${id}`);
        return `v-${id}`;
      },
      buildWithStamp: async (id) => {
        if (stampSettled < ids10.length) payloadStartsBeforeAllStamps += 1;
        events.push(`payload:${id}`);
        await new Promise((r) => setTimeout(r, 1));
        return { id };
      },
    });

    expect(payloadStartsBeforeAllStamps).toBe(0);
    const lastStamp = events.map((e) => e.startsWith('stamp:')).lastIndexOf(true);
    const firstPayload = events.findIndex((e) => e.startsWith('payload:'));
    expect(firstPayload).toBeGreaterThan(lastStamp);
    expect(events.filter((e) => e.startsWith('stamp:')).length).toBe(10);
    expect(events.filter((e) => e.startsWith('payload:')).length).toBe(10);
  });

  it('任一時刻 stamp 併發 <=2、payload 併發 <=2，兩階段 active 不重疊', async () => {
    const runBatchPhases = loadRunBatchPhases();
    let stampActive = 0;
    let payloadActive = 0;
    let maxStamp = 0;
    let maxPayload = 0;
    let overlap = 0;

    await runBatchPhases(ids10, {
      concurrency: 2,
      computeStamp: async (id) => {
        stampActive += 1;
        maxStamp = Math.max(maxStamp, stampActive);
        if (payloadActive > 0) overlap += 1;
        await new Promise((r) => setTimeout(r, 3));
        stampActive -= 1;
        return `v-${id}`;
      },
      buildWithStamp: async (id) => {
        payloadActive += 1;
        maxPayload = Math.max(maxPayload, payloadActive);
        if (stampActive > 0) overlap += 1;
        await new Promise((r) => setTimeout(r, 3));
        payloadActive -= 1;
        return { id };
      },
    });

    expect(maxStamp).toBeLessThanOrEqual(2);
    expect(maxPayload).toBeLessThanOrEqual(2);
    expect(overlap).toBe(0);
  });

  it('stamp failure 只落該 code error；其餘仍進 payload，輸出仍依原 batch order', async () => {
    const runBatchPhases = loadRunBatchPhases();
    const payloadCalls: string[] = [];
    const bad = new Set([ids10[2], ids10[7]]);

    const out = await runBatchPhases(ids10, {
      concurrency: 2,
      computeStamp: async (id) => {
        if (bad.has(id)) throw new Error(`stamp down ${id}`);
        return `v-${id}`;
      },
      buildWithStamp: async (id, stampVer) => {
        payloadCalls.push(id);
        return { id, stampVer };
      },
    });

    expect(out.map((r) => r.id)).toEqual(ids10);
    for (const r of out) {
      if (bad.has(r.id)) {
        expect(r.ok).toBe(false);
        expect(r.error).toBe(`stamp down ${r.id}`);
        expect(r.value).toBeUndefined();
      } else {
        expect(r.ok).toBe(true);
        expect(r.value).toEqual({ id: r.id, stampVer: `v-${r.id}` });
      }
    }
    expect(payloadCalls.sort()).toEqual(ids10.filter((c) => !bad.has(c)).sort());
    expect(payloadCalls).not.toContain(ids10[2]);
    expect(payloadCalls).not.toContain(ids10[7]);
  });

  it('payload failure 只落該 code error，不影響其他 code', async () => {
    const runBatchPhases = loadRunBatchPhases();
    const out = await runBatchPhases(ids10, {
      concurrency: 2,
      computeStamp: async (id) => `v-${id}`,
      buildWithStamp: async (id) => {
        if (id === ids10[4]) throw new Error('payload down');
        return { id };
      },
    });
    expect(out.map((r) => r.id)).toEqual(ids10);
    expect(out[4]).toEqual({ ok: false, id: ids10[4], error: 'payload down' });
    expect(out.filter((r) => r.ok).length).toBe(9);
  });

  it('payload phase 的 build function 只吃 precomputed stamp：source 內 computeChipsStamp 只出現在 stamp phase 與 single path', () => {
    // buildPayloadWithStamp 內不得出現 computeChipsStamp
    const b = src.indexOf('async function buildPayloadWithStamp');
    const e = src.indexOf('// ====', b) === -1 ? src.indexOf('Deno.serve', b) : src.indexOf('Deno.serve', b);
    const block = src.slice(b, e);
    expect(b).toBeGreaterThan(-1);
    expect(block).not.toMatch(/computeChipsStamp/);
    // buildChipsPayload 內也不得算 stamp
    const pb = src.indexOf('async function buildChipsPayload');
    const pe = src.indexOf('// ============================================================\n// Batch helpers');
    expect(src.slice(pb, pe)).not.toMatch(/computeChipsStamp/);
    // 整檔 computeChipsStamp 呼叫恰兩處：single path + stamp phase 的 computeStamp
    const calls = src.match(/computeChipsStamp\(supa/g) ?? [];
    expect(calls.length).toBe(2);
    // 舊的 buildOne / withConcurrency 已移除
    expect(src).not.toMatch(/function buildOne\(/);
    expect(src).not.toMatch(/withConcurrency/);
  });
});
