// Build2 M1 — storage_objects capability probe 回歸測試
// deno test -A supabase/functions/_shared/finmindMarketBatch_test.ts

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  MAX_PROBE_BYTES,
  probeMarketBatchSupport,
  readBoundedBody,
  resolveProbeDate,
  sanitizeUpstreamError,
} from './finmindMarketBatch.ts';
import { RateLimitExhaustedError } from './finmindRateLimit.ts';

// ---------- resolveProbeDate（未修改，維持既有語意） ----------

Deno.test('resolveProbeDate: 週六回捲到週五', () => {
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

// ---------- stub 基礎建設 ----------

interface Patch { [k: string]: unknown }

function stubSupa(
  patches: Patch[],
  cfg: Record<string, unknown> = {},
  tradingDays: string[] | null = ['2026-08-10', '2026-08-11', '2026-08-12'],
) {
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
    rpc(name: string) {
      if (name === 'tw_trading_days') {
        if (tradingDays === null) return Promise.resolve({ data: null, error: { message: 'boom' } });
        return Promise.resolve({ data: tradingDays, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
  return supa;
}

interface FetchLog {
  url: string;
  read: number;
  cancelled: boolean;
  calls: number;
}

/** 建立可觀測讀取量的 Response stub。 */
function streamResponse(
  chunks: Uint8Array[],
  init: ResponseInit,
  log: FetchLog,
): Response {
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (i >= chunks.length) { ctrl.close(); return; }
      const c = chunks[i++];
      log.read += c.byteLength;
      ctrl.enqueue(c);
    },
    cancel() { log.cancelled = true; },
  });
  return new Response(body, init);
}

function withFetch(
  handler: (url: string, log: FetchLog) => Response,
  fn: (log: FetchLog) => Promise<void>,
): () => Promise<void> {
  return async () => {
    const original = globalThis.fetch;
    const log: FetchLog = { url: '', read: 0, cancelled: false, calls: 0 };
    globalThis.fetch = ((input: string | URL | Request) => {
      log.calls++;
      log.url = String(input);
      return Promise.resolve(handler(log.url, log));
    }) as typeof fetch;
    try { await fn(log); } finally { globalThis.fetch = original; }
  };
}

const PAR1 = new Uint8Array([0x50, 0x41, 0x52, 0x31]);
function bigParquet(totalBytes: number): Uint8Array[] {
  const chunks: Uint8Array[] = [PAR1];
  let left = totalBytes - 4;
  while (left > 0) {
    const n = Math.min(left, 16 * 1024);
    chunks.push(new Uint8Array(n).fill(0x41));
    left -= n;
  }
  return chunks;
}
function textChunks(s: string): Uint8Array[] {
  return [new TextEncoder().encode(s)];
}

// ---------- readBoundedBody ----------

Deno.test('readBoundedBody: 超量 body 只讀 <= 上限並 cancel', async () => {
  const log: FetchLog = { url: '', read: 0, cancelled: false, calls: 0 };
  const res = streamResponse(bigParquet(1_000_000), { status: 200 }, log);
  const bytes = await readBoundedBody(res);
  assertEquals(bytes.byteLength, MAX_PROBE_BYTES);
  assert(log.read <= MAX_PROBE_BYTES + 32 * 1024, `read=${log.read}`);
  assert(log.cancelled, 'reader 必須被 cancel');
});

// ---------- probe tri-state ----------

Deno.test('probe: 200 + PAR1（上游忽略 Range 回大 body）→ supported/parquet，讀取 <= 64KiB', withFetch(
  (_u, log) => streamResponse(bigParquet(5_000_000), { status: 200 }, log),
  async (log) => {
    const patches: Patch[] = [];
    const supa = stubSupa(patches);
    const r = await probeMarketBatchSupport(supa, { force: true });
    assertEquals(r.outcome, 'supported');
    assertEquals(r.supported, true);
    assertEquals(r.probe_date, '2026-08-12', '必須用 tw_trading_days 的 latest trading date');
    assert(log.url.includes('/api/v4/storage_objects'));
    assert(log.url.includes('dataset=TaiwanStockTradingDailyReport'));
    assert(log.read <= MAX_PROBE_BYTES + 32 * 1024, `read=${log.read}`);
    assert(log.cancelled);
    const last = patches[patches.length - 1];
    assertEquals(last.supported, true);
    assertEquals(last.last_probe_format, 'parquet');
    assert(typeof last.probed_at === 'string');
  },
));

Deno.test('probe: content-length > 80MB → inconclusive，body 完全未讀', withFetch(
  (_u, log) => streamResponse(bigParquet(1_000_000), {
    status: 200,
    headers: { 'content-length': String(100 * 1024 * 1024) },
  }, log),
  async (log) => {
    const patches: Patch[] = [];
    const supa = stubSupa(patches, { supported: true, probed_at: '2026-08-10T00:00:00.000Z' });
    const r = await probeMarketBatchSupport(supa, { force: true });
    assertEquals(r.outcome, 'inconclusive');
    // 只允許 stream 自身的 prefetch buffer；不得進入 bounded reader 消費路徑
    assert(log.read <= 16 * 1024, `body 不得被讀取, read=${log.read}`);
    const last = patches[patches.length - 1];
    assertEquals(last.supported, true, 'inconclusive 不得改寫 supported');
    assertEquals(last.probed_at, '2026-08-10T00:00:00.000Z');
    assert(String(last.last_probe_error).includes('oversize'));
  },
));

Deno.test('probe: 200 JSON signed URL → supported/signed_url_unverified，不輸出 URL、不二次 fetch', withFetch(
  (_u, log) => streamResponse(
    textChunks(JSON.stringify({ status: 200, url: 'https://storage.example.com/secret?sig=abc' })),
    { status: 200 },
    log,
  ),
  async (log) => {
    const patches: Patch[] = [];
    const supa = stubSupa(patches);
    const r = await probeMarketBatchSupport(supa, { force: true });
    assertEquals(r.outcome, 'supported');
    const last = patches[patches.length - 1];
    assertEquals(last.last_probe_format, 'signed_url_unverified');
    assertEquals(log.calls, 1, '不得跟隨 signed URL');
    assert(log.read <= MAX_PROBE_BYTES);
    const dump = JSON.stringify(r) + JSON.stringify(patches);
    assert(!dump.includes('storage.example.com'), 'URL 不得出現在輸出或 config');
    assert(!dump.includes('sig=abc'));
  },
));

Deno.test('probe: HTTP 401 且 body 含 permission/sponsor → auth_failed/inconclusive，保留前值', withFetch(
  (_u, log) => streamResponse(
    textChunks('{"msg":"permission denied, sponsor plan required"}'),
    { status: 401 },
    log,
  ),
  async () => {
    const patches: Patch[] = [];
    const supa = stubSupa(patches, { supported: true, probed_at: '2026-08-10T00:00:00.000Z' });
    const r = await probeMarketBatchSupport(supa, { force: true });
    assertEquals(r.outcome, 'inconclusive');
    assertEquals(r.supported, true, 'supported 前值必須保留');
    const last = patches[patches.length - 1];
    assertEquals(last.supported, true);
    assertEquals(last.probed_at, '2026-08-10T00:00:00.000Z', 'probed_at 不得被覆寫');
    assert(String(last.last_probe_error).includes('auth_failed'));
  },
));

Deno.test('probe: HTTP 403 → unsupported_plan', withFetch(
  (_u, log) => streamResponse(textChunks('forbidden: sponsorpro only'), { status: 403 }, log),
  async () => {
    const patches: Patch[] = [];
    const supa = stubSupa(patches, { supported: true, probed_at: '2026-08-10T00:00:00.000Z' });
    const r = await probeMarketBatchSupport(supa, { force: true });
    assertEquals(r.outcome, 'unsupported');
    assertEquals(r.supported, false);
    const last = patches[patches.length - 1];
    assertEquals(last.supported, false);
    assert(String(last.last_probe_error).includes('unsupported_plan'));
  },
));

Deno.test('probe: HTTP 400 參數契約 → unsupported_contract', withFetch(
  (_u, log) => streamResponse(textChunks('{"msg":"date can not be none"}'), { status: 400 }, log),
  async () => {
    const patches: Patch[] = [];
    const supa = stubSupa(patches);
    const r = await probeMarketBatchSupport(supa, { force: true });
    assertEquals(r.outcome, 'unsupported');
    assert(String(patches[patches.length - 1].last_probe_error).includes('unsupported_contract'));
  },
));

for (const [label, init, body] of [
  ['404', { status: 404 }, 'not found'],
  ['429', { status: 429 }, 'too many requests'],
  ['500', { status: 500 }, 'upstream down'],
  ['bad magic', { status: 200 }, '<html>nope</html>'],
  ['0 bytes', { status: 200 }, ''],
] as [string, ResponseInit, string][]) {
  Deno.test(`probe: ${label} → inconclusive 保留前值`, withFetch(
    (_u, log) => streamResponse(body ? textChunks(body) : [], init, log),
    async () => {
      const patches: Patch[] = [];
      const supa = stubSupa(patches, { supported: true, probed_at: '2026-08-10T00:00:00.000Z' });
      const r = await probeMarketBatchSupport(supa, { force: true });
      assertEquals(r.outcome, 'inconclusive');
      assertEquals(r.supported, true);
      const last = patches[patches.length - 1];
      assertEquals(last.supported, true);
      assertEquals(last.probed_at, '2026-08-10T00:00:00.000Z');
    },
  ));
}

Deno.test('probe: fetch timeout/abort → inconclusive', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new DOMException('signal timed out', 'TimeoutError'))) as typeof fetch;
  try {
    const patches: Patch[] = [];
    const supa = stubSupa(patches, { supported: true, probed_at: '2026-08-10T00:00:00.000Z' });
    const r = await probeMarketBatchSupport(supa, { force: true });
    assertEquals(r.outcome, 'inconclusive');
    assertEquals(patches[patches.length - 1].supported, true);
    assertEquals(patches[patches.length - 1].probed_at, '2026-08-10T00:00:00.000Z');
  } finally { globalThis.fetch = original; }
});

// ---------- probe date（交易日曆） ----------

Deno.test('probe date: 國定休市不會被選中（取 tw_trading_days 最後一天）', withFetch(
  (_u, log) => streamResponse([PAR1], { status: 200 }, log),
  async () => {
    const patches: Patch[] = [];
    // 2026-08-13/14 為休市 → 日曆只回到 08-12
    const supa = stubSupa(patches, {}, ['2026-08-11', '2026-08-12']);
    const r = await probeMarketBatchSupport(supa, { force: true });
    assertEquals(r.probe_date, '2026-08-12');
    assert(!String(patches[patches.length - 1].last_probe_error ?? '').includes('calendar_fallback'));
  },
));

Deno.test('probe date: 日曆查詢失敗 → fallback resolveProbeDate 並標 calendar_fallback', withFetch(
  (_u, log) => streamResponse([PAR1], { status: 200 }, log),
  async () => {
    const patches: Patch[] = [];
    const supa = stubSupa(patches, {}, null);
    const r = await probeMarketBatchSupport(supa, { force: true });
    assertEquals(r.probe_date, resolveProbeDate());
    assert(String(patches[patches.length - 1].last_probe_error).includes('calendar_fallback'));
  },
));

// ---------- top-level shape / idempotency ----------

Deno.test('probe: success response top-level keys 不增不減', withFetch(
  (_u, log) => streamResponse([PAR1], { status: 200 }, log),
  async () => {
    const supa = stubSupa([]);
    const r = await probeMarketBatchSupport(supa, { force: true });
    const allowed = new Set(['supported', 'outcome', 'stocks', 'probe_date', 'sample', 'skipped', 'error']);
    for (const k of Object.keys(r)) assert(allowed.has(k), `unexpected top-level key: ${k}`);
    assert('supported' in r && 'outcome' in r && 'stocks' in r && 'probe_date' in r);
  },
));

Deno.test('probe: 非 force 且 24h 內 → skipped，不打 API', async () => {
  const patches: Patch[] = [];
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => { calls++; return Promise.resolve(new Response('')); }) as typeof fetch;
  try {
    const supa = stubSupa(patches, { supported: false, probed_at: new Date().toISOString() });
    const r = await probeMarketBatchSupport(supa, {});
    assert(String(r.skipped).startsWith('probed_'));
    assertEquals(patches.length, 0);
    assertEquals(calls, 0);
  } finally { globalThis.fetch = original; }
});

Deno.test('RateLimitExhaustedError 型別仍可用（未被 M1 移除）', () => {
  assert(new RateLimitExhaustedError({ used: 1, limit: 1 }) instanceof Error);
});

// ---------- P6-R1 sanitizeUpstreamError ----------

Deno.test('sanitize: nested token_tail 被遮罩', () => {
  const s = sanitizeUpstreamError('unsupported_plan:http_400:' + JSON.stringify({ msg: 'Your level is sponsor', detail: { token_tail: 'abc123' } }));
  assert(!s.includes('abc123'));
  assert(s.includes('sponsor'));
});

Deno.test('sanitize: array 內含敏感 key 被遮罩', () => {
  const s = sanitizeUpstreamError(JSON.stringify({ msg: 'x', detail: [{ access_token: 'zzz999' }] }));
  assert(!s.includes('zzz999'));
});

Deno.test('sanitize: mixed case key（Token_Tail / ACCESS_TOKEN / Signed_URL）', () => {
  const s = sanitizeUpstreamError(JSON.stringify({ Token_Tail: 'aaa111', ACCESS_TOKEN: 'bbb222', Signed_URL: 'https://x/y?sig=ccc333' }));
  assert(!s.includes('aaa111') && !s.includes('bbb222') && !s.includes('ccc333'));
});

Deno.test('sanitize: msg 內含 signed URL', () => {
  const s = sanitizeUpstreamError(JSON.stringify({ msg: 'go to https://s3.example.com/f.parquet?X-Amz-Signature=deadbeefdeadbeef' }));
  assert(!s.includes('deadbeef'));
});

Deno.test('sanitize: msg 內含 Bearer', () => {
  const s = sanitizeUpstreamError(JSON.stringify({ msg: 'auth Bearer supersecrettokenvalue failed' }));
  assert(!s.includes('supersecrettokenvalue'));
});

Deno.test('sanitize: msg 內含 token=xxx', () => {
  const s = sanitizeUpstreamError(JSON.stringify({ msg: 'query token=abcdef12345 rejected' }));
  assert(!s.includes('abcdef12345'));
});

Deno.test('sanitize: 長 token-like 字串被遮罩', () => {
  const s = sanitizeUpstreamError('raw eyJhbGciOiJIUzI1NiJ9abcdefghijklmnop end');
  assert(!s.includes('eyJhbGciOiJIUzI1NiJ9abcdefghijklmnop'));
});

Deno.test('sanitize: 循環引用不炸（字串路徑）', () => {
  const s = sanitizeUpstreamError('plain {not json');
  assert(typeof s === 'string');
});

Deno.test('sanitize: 非 JSON 純文字保留可讀資訊', () => {
  const s = sanitizeUpstreamError('http_500:upstream gateway error');
  assert(s.includes('upstream gateway error'));
});

Deno.test('sanitize: 正常 msg/status 保留、未白名單 key 遮罩', () => {
  const s = sanitizeUpstreamError(JSON.stringify({ msg: 'bad date', status: 400, weird: 'internal-path-info' }));
  assert(s.includes('bad date'));
  assert(s.includes('400'));
  assert(!s.includes('internal-path-info'));
});

Deno.test('sanitize: 截斷 300 字', () => {
  const s = sanitizeUpstreamError('x'.repeat(1000));
  assertEquals(s.length, 300);
});
