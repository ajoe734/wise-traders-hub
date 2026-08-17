import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  OFFICIAL_FINMIND_URL,
  buildEvidence,
  resolveProbeUrl,
  runProviderProbe,
} from './bsrAdmissionProbe.ts';

Deno.test('resolveProbeUrl: 預設 official', () => {
  assertEquals(resolveProbeUrl(undefined, false).url, OFFICIAL_FINMIND_URL);
  assertEquals(resolveProbeUrl(undefined, false).source, 'official');
});

Deno.test('resolveProbeUrl: 非 loopback 注入被忽略（防 SSRF）', () => {
  assertEquals(resolveProbeUrl('https://evil.example.com', true).url, OFFICIAL_FINMIND_URL);
  assertEquals(resolveProbeUrl('https://evil.example.com', true).source, 'official');
});

Deno.test('resolveProbeUrl: allowLocal=false 時 loopback 也被忽略', () => {
  assertEquals(resolveProbeUrl('http://127.0.0.1:9999/x', false).url, OFFICIAL_FINMIND_URL);
});

Deno.test('resolveProbeUrl: 測試環境 loopback 可注入', () => {
  const r = resolveProbeUrl('http://127.0.0.1:9999/x', true);
  assertEquals(r.url, 'http://127.0.0.1:9999/x');
  assertEquals(r.source, 'injected_local');
});

Deno.test('buildEvidence: 只含白名單欄位，無 token/url/raw', () => {
  const e = buildEvidence({
    httpStatus: 200, rowCount: 3, stockId: '2330', tradeDate: '2026-08-14',
    urlSource: 'official', elapsedMs: 12.4,
  });
  const keys = Object.keys(e).sort();
  assertEquals(keys, [
    'admission_probe_schema_version', 'dataset', 'elapsed_ms', 'endpoint_source',
    'http_status', 'probe_at', 'provider', 'sample_row_count', 'sample_stock_id',
    'sample_trade_date',
  ]);
  assert(!JSON.stringify(e).includes('Bearer'));
});

function mockFetch(status: number, body: unknown): typeof fetch {
  return ((_u: string | URL | Request, _i?: RequestInit) =>
    Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))) as typeof fetch;
}

const base = { stockId: '2330', tradeDate: '2026-08-14', token: 't' };

Deno.test('probe: 200 + rows>0 → success', async () => {
  const r = await runProviderProbe({ ...base, fetchImpl: mockFetch(200, { data: [{ a: 1 }] }) });
  assertEquals(r.success, true);
  assertEquals(r.outcome, 'ok');
  assertEquals(r.evidence.sample_row_count, '1');
});

Deno.test('probe: 200 + 空 data → 不算 success', async () => {
  const r = await runProviderProbe({ ...base, fetchImpl: mockFetch(200, { data: [] }) });
  assertEquals(r.success, false);
  assertEquals(r.error, 'empty_dataset');
});

Deno.test('probe: HTTP 200 但 body.status=400 方案拒絕 → terminal，不 success', async () => {
  const r = await runProviderProbe({
    ...base,
    fetchImpl: mockFetch(200, { status: 400, msg: 'Your level is register, please upgrade your level.' }),
  });
  assertEquals(r.success, false);
  assertEquals(r.outcome, 'terminal');
});

Deno.test('probe: HTTP 400 方案拒絕 → terminal', async () => {
  const r = await runProviderProbe({
    ...base, fetchImpl: mockFetch(400, { msg: 'Your level is register, please upgrade your level.' }),
  });
  assertEquals(r.success, false);
  assertEquals(r.outcome, 'terminal');
  assertEquals(r.httpStatus, 400);
});

Deno.test('probe: 429 → retryable，不 success', async () => {
  const r = await runProviderProbe({ ...base, fetchImpl: mockFetch(429, { msg: 'rate limit' }) });
  assertEquals(r.success, false);
  assertEquals(r.outcome, 'retryable');
});

Deno.test('probe: 500 → 不 success', async () => {
  const r = await runProviderProbe({ ...base, fetchImpl: mockFetch(500, 'boom') });
  assertEquals(r.success, false);
  assertEquals(r.httpStatus, 500);
});

Deno.test('probe: 非 JSON → invalid_json，不 success', async () => {
  const r = await runProviderProbe({ ...base, fetchImpl: mockFetch(200, '<html>') });
  assertEquals(r.success, false);
  assertEquals(r.error, 'invalid_json');
});

Deno.test('probe: network throw 不外洩例外', async () => {
  const r = await runProviderProbe({
    ...base,
    fetchImpl: (() => Promise.reject(new Error('connect ECONNREFUSED'))) as unknown as typeof fetch,
  });
  assertEquals(r.success, false);
  assertEquals(r.httpStatus, null);
});
