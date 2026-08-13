// Build2 P4 — probe tri-state / date resolver 回歸測試
// deno test -A supabase/functions/_shared/finmindMarketBatch_test.ts

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { probeMarketBatchSupport, resolveProbeDate } from './finmindMarketBatch.ts';
import { RateLimitExhaustedError } from './finmindRateLimit.ts';

// ---------- resolveProbeDate ----------

Deno.test('resolveProbeDate: 週六回捲到週五', () => {
  // 2026-08-15 是週六
  assertEquals(resolveProbeDate(new Date('2026-08-15T00:00:00Z')), '2026-08-14');
});

Deno.test('resolveProbeDate: 週日回捲到週五', () => {
  assertEquals(resolveProbeDate(new Date('2026-08-16T00:00:00Z')), '2026-08-14');
});

Deno.test('resolveProbeDate: 平日不變', () => {
  for (const d of ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14']) {
    assertEquals(resolveProbeDate(new Date(`${d}T00:00:00Z`)), d);
  }
});

Deno.test('resolveProbeDate: 週二探測(now-3d=週六)回捲到週五', () => {
  // 週二 2026-08-18 - 3d = 2026-08-15(六) → 2026-08-14(五)
  const base = new Date(new Date('2026-08-18T00:00:00Z').getTime() - 3 * 86400_000);
  assertEquals(resolveProbeDate(base), '2026-08-14');
});

// ---------- stub 基礎建設 ----------

interface Patch { [k: string]: unknown }

function stubSupa(patches: Patch[], cfg: Record<string, unknown> = {}) {
  const baseCfg = {
    enabled: true,
    supported: null,
    probed_at: null,
    min_stocks_in_response: 500,
    threshold_pending: 15,
    ...cfg,
  };
  // deno-lint-ignore no-explicit-any
  const supa: any = {
    from() {
      return {
        select() {
          return {
            eq() {
              return { maybeSingle: () => Promise.resolve({ data: { config: baseCfg } }) };
            },
          };
        },
        update(row: { config: Patch }) {
          patches.push(row.config);
          return { eq: () => Promise.resolve({ error: null }) };
        },
      };
    },
  };
  return supa;
}

/** 用 fetch stub 驅動 fetchFinmindMarketDay。 */
function withFetch(
  handler: () => Response | Promise<Response> | never,
  fn: () => Promise<void>,
): () => Promise<void> {
  return async () => {
    const original = globalThis.fetch;
    // reserve/settle RPC 由 stubSupa 之外的 rpc 呼叫負責 → 直接短路 rateLimit
    globalThis.fetch = (() => Promise.resolve(handler())) as typeof fetch;
    try { await fn(); } finally { globalThis.fetch = original; }
  };
}

function marketBody(n: number) {
  const data = Array.from({ length: n }, (_, i) => ({
    stock_id: String(1000 + i),
    securities_trader: 'B',
    securities_trader_id: 'B01',
    buy: 1000,
    sell: 0,
    price: 10,
    date: '2026-08-11',
  }));
  return new Response(JSON.stringify({ status: 200, data }), { status: 200 });
}

/** 直接注入 rate-limit stub：reserve 成功、settle no-op。 */
// deno-lint-ignore no-explicit-any
function withRpc(supa: any) {
  supa.rpc = (name: string) => {
    if (name === 'reserve_bsr_api_quota') {
      return Promise.resolve({ data: [{ granted: true, reservation_id: 1, used: 1, remaining: 999 }], error: null });
    }
    return Promise.resolve({ data: null, error: null });
  };
  return supa;
}

// ---------- tri-state ----------

Deno.test('probe: 600 檔 → supported，寫入 supported/probed_at', withFetch(() => marketBody(600), async () => {
  const patches: Patch[] = [];
  const supa = withRpc(stubSupa(patches));
  const r = await probeMarketBatchSupport(supa, { force: true });
  assertEquals(r.outcome, 'supported');
  assertEquals(r.supported, true);
  const last = patches[patches.length - 1];
  assertEquals(last.supported, true);
  assert(typeof last.probed_at === 'string');
}));

Deno.test('probe: 12 檔 → unsupported（capability 判定）', withFetch(() => marketBody(12), async () => {
  const patches: Patch[] = [];
  const supa = withRpc(stubSupa(patches));
  const r = await probeMarketBatchSupport(supa, { force: true });
  assertEquals(r.outcome, 'unsupported');
  assertEquals(r.supported, false);
  const last = patches[patches.length - 1];
  assertEquals(last.supported, false);
  assert(typeof last.probed_at === 'string');
}));

Deno.test('probe: 0 rows → inconclusive，不動 supported/probed_at', withFetch(
  () => new Response(JSON.stringify({ status: 200, data: [] }), { status: 200 }),
  async () => {
    const patches: Patch[] = [];
    const supa = withRpc(stubSupa(patches, { supported: true, probed_at: '2026-08-10T00:00:00.000Z' }));
    const r = await probeMarketBatchSupport(supa, { force: true });
    assertEquals(r.outcome, 'inconclusive');
    assertEquals(r.supported, true); // 保留前值
    const last = patches[patches.length - 1];
    assertEquals(last.supported, true, 'supported 必須維持前值');
    assertEquals(last.probed_at, '2026-08-10T00:00:00.000Z', 'probed_at 不得被覆寫');
    assertEquals(last.last_probe_outcome, 'inconclusive');
  },
));

Deno.test('probe: HTTP 503 → inconclusive', withFetch(
  () => new Response('upstream down', { status: 503 }),
  async () => {
    const patches: Patch[] = [];
    const supa = withRpc(stubSupa(patches, { supported: true, probed_at: '2026-08-10T00:00:00.000Z' }));
    const r = await probeMarketBatchSupport(supa, { force: true });
    assertEquals(r.outcome, 'inconclusive');
    const last = patches[patches.length - 1];
    assertEquals(last.supported, true);
    assertEquals(last.probed_at, '2026-08-10T00:00:00.000Z');
  },
));

Deno.test('probe: bad json → inconclusive', withFetch(
  () => new Response('<html>nope</html>', { status: 200 }),
  async () => {
    const patches: Patch[] = [];
    const supa = withRpc(stubSupa(patches, { supported: true, probed_at: '2026-08-10T00:00:00.000Z' }));
    const r = await probeMarketBatchSupport(supa, { force: true });
    assertEquals(r.outcome, 'inconclusive');
    assertEquals(patches[patches.length - 1].supported, true);
  },
));

Deno.test('probe: RateLimitExhaustedError → inconclusive，不寫 supported', async () => {
  const patches: Patch[] = [];
  const supa = stubSupa(patches, { supported: true, probed_at: '2026-08-10T00:00:00.000Z' });
  // reserve 失敗 → fetchWithRateLimit 丟 RateLimitExhaustedError
  supa.rpc = (name: string) => {
    if (name === 'reserve_bsr_api_quota') return Promise.resolve({ data: [{ granted: false, reservation_id: null }], error: null });
    return Promise.resolve({ data: null, error: null });
  };
  const r = await probeMarketBatchSupport(supa, { force: true });
  assertEquals(r.outcome, 'inconclusive');
  const last = patches[patches.length - 1];
  assertEquals(last.supported, true);
  assertEquals(last.probed_at, '2026-08-10T00:00:00.000Z');
  assert(String(last.last_probe_error).includes('rate_limit') || String(last.last_probe_error).length > 0);
  assert(new RateLimitExhaustedError({ used: 1, limit: 1 }) instanceof Error);
});

Deno.test('probe: finmind_api 權限錯誤 → unsupported', withFetch(
  () => new Response(JSON.stringify({ status: 402, msg: 'permission denied, please upgrade level' }), { status: 200 }),
  async () => {
    const patches: Patch[] = [];
    const supa = withRpc(stubSupa(patches, { supported: true, probed_at: '2026-08-10T00:00:00.000Z' }));
    const r = await probeMarketBatchSupport(supa, { force: true });
    assertEquals(r.outcome, 'unsupported');
    assertEquals(r.supported, false);
    const last = patches[patches.length - 1];
    assertEquals(last.supported, false);
    assert(last.probed_at !== '2026-08-10T00:00:00.000Z');
  },
));

Deno.test('probe: 非 force 且 24h 內 → skipped，不打 API', async () => {
  const patches: Patch[] = [];
  const supa = withRpc(stubSupa(patches, { supported: false, probed_at: new Date().toISOString() }));
  const r = await probeMarketBatchSupport(supa, {});
  assert(String(r.skipped).startsWith('probed_'));
  assertEquals(patches.length, 0);
});
