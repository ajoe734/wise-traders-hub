import { assertEquals, assertRejects } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import {
  computeBackoffDelay,
  DEFAULT_RETRY_POLICY,
  fetchWithRetry,
  isRetryableNetworkError,
  isRetryableStatus,
  parseRetryAfter,
  redactUrl,
  RetryExhaustedError,
  recordRetryFailure,
} from './retryFetch.ts';

const noSleep = async (_ms: number) => {};

Deno.test('isRetryableStatus: 只有暫時性狀態碼會重試', () => {
  for (const s of [408, 425, 429, 500, 502, 503, 504]) {
    assertEquals(isRetryableStatus(s), true, `${s} should retry`);
  }
  for (const s of [200, 204, 301, 400, 401, 403, 404, 422]) {
    assertEquals(isRetryableStatus(s), false, `${s} should not retry`);
  }
});

Deno.test('isRetryableNetworkError: abort/timeout/連線錯誤', () => {
  const abort = new Error('aborted');
  abort.name = 'AbortError';
  assertEquals(isRetryableNetworkError(abort), true);
  assertEquals(isRetryableNetworkError(new Error('connection reset by peer')), true);
  assertEquals(isRetryableNetworkError(new Error('signal timed out')), true);
  assertEquals(isRetryableNetworkError(new TypeError('Invalid URL')), false);
});

Deno.test('parseRetryAfter: 秒數與 HTTP-date', () => {
  assertEquals(parseRetryAfter('5'), 5000);
  assertEquals(parseRetryAfter(null), null);
  assertEquals(parseRetryAfter('bogus'), null);
  const now = Date.UTC(2026, 0, 1, 0, 0, 0);
  assertEquals(parseRetryAfter('Thu, 01 Jan 2026 00:00:30 GMT', now), 30_000);
  assertEquals(parseRetryAfter('Thu, 01 Jan 2020 00:00:00 GMT', now), 0);
});

Deno.test('computeBackoffDelay: 指數成長、上限與抖動', () => {
  const p = { ...DEFAULT_RETRY_POLICY, baseDelayMs: 100, maxDelayMs: 1000, jitterRatio: 0 };
  assertEquals(computeBackoffDelay(1, p, null, () => 0.5), 100);
  assertEquals(computeBackoffDelay(2, p, null, () => 0.5), 200);
  assertEquals(computeBackoffDelay(3, p, null, () => 0.5), 400);
  assertEquals(computeBackoffDelay(9, p, null, () => 0.5), 1000); // capped
  const jittered = computeBackoffDelay(1, { ...p, jitterRatio: 0.5 }, null, () => 1);
  assertEquals(jittered, 150);
  const jitteredLow = computeBackoffDelay(1, { ...p, jitterRatio: 0.5 }, null, () => 0);
  assertEquals(jitteredLow, 50);
});

Deno.test('computeBackoffDelay: Retry-After 優先，但受 maxRetryAfterMs 限制', () => {
  const p = { ...DEFAULT_RETRY_POLICY, baseDelayMs: 100, maxRetryAfterMs: 10_000 };
  assertEquals(computeBackoffDelay(1, p, 3000), 3000);
  assertEquals(computeBackoffDelay(1, p, 999_000), 10_000);
});

Deno.test('redactUrl: token 不落地', () => {
  const out = redactUrl('https://api.finmindtrade.com/api/v4/data?dataset=X&token=abc123');
  assertEquals(out.includes('abc123'), false);
  assertEquals(out.includes('token=***'), true);
});

Deno.test('fetchWithRetry: 429 後成功，記錄退避時間軸', async () => {
  let calls = 0;
  const waits: number[] = [];
  const res = await fetchWithRetry('https://x.test/a', {}, {
    source: 'unit',
    policy: { baseDelayMs: 10, jitterRatio: 0 },
    rand: () => 0.5,
    sleep: async (ms) => { waits.push(ms); },
    fetchImpl: async () => {
      calls += 1;
      return calls < 3
        ? new Response('slow down', { status: 429 })
        : new Response('ok', { status: 200 });
    },
  });
  assertEquals(res.status, 200);
  assertEquals(calls, 3);
  assertEquals(waits, [10, 20]);
});

Deno.test('fetchWithRetry: 400 不重試，直接回傳', async () => {
  let calls = 0;
  const res = await fetchWithRetry('https://x.test/a', {}, {
    source: 'unit',
    sleep: noSleep,
    fetchImpl: async () => { calls += 1; return new Response('bad', { status: 400 }); },
  });
  assertEquals(res.status, 400);
  assertEquals(calls, 1);
});

Deno.test('fetchWithRetry: 遵守 Retry-After', async () => {
  const waits: number[] = [];
  let calls = 0;
  await fetchWithRetry('https://x.test/a', {}, {
    source: 'unit',
    policy: { maxAttempts: 2, baseDelayMs: 1000, jitterRatio: 0 },
    sleep: async (ms) => { waits.push(ms); },
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? new Response('', { status: 503, headers: { 'retry-after': '2' } })
        : new Response('ok', { status: 200 });
    },
  });
  assertEquals(waits, [2000]);
});

Deno.test('fetchWithRetry: 超過上限丟出可追溯的 RetryExhaustedError', async () => {
  let calls = 0;
  const err = await assertRejects(
    () =>
      fetchWithRetry('https://api.finmindtrade.com/api/v4/data?token=secret', {}, {
        source: 'finmind_bsr',
        policy: { maxAttempts: 3, baseDelayMs: 5, jitterRatio: 0 },
        sleep: noSleep,
        fetchImpl: async () => { calls += 1; return new Response('boom', { status: 502 }); },
      }),
    RetryExhaustedError,
  );
  assertEquals(calls, 3);
  assertEquals(err.attempts.length, 3);
  assertEquals(err.lastStatus, 502);
  const trace = err.toTrace();
  assertEquals(trace.code, 'UPSTREAM_RETRY_EXHAUSTED');
  assertEquals(trace.source, 'finmind_bsr');
  assertEquals(trace.attempts, 3);
  assertEquals(String(trace.url).includes('secret'), false);
  assertEquals(err.totalWaitMs, 15); // 5 + 10 + 0(最後一次不等待)
});

Deno.test('fetchWithRetry: 網路錯誤也重試，最後保留原因', async () => {
  let calls = 0;
  const err = await assertRejects(
    () =>
      fetchWithRetry('https://x.test/a', {}, {
        source: 'twse_t86',
        policy: { maxAttempts: 2, baseDelayMs: 1, jitterRatio: 0 },
        sleep: noSleep,
        fetchImpl: async () => {
          calls += 1;
          throw new Error('connection reset by peer');
        },
      }),
    RetryExhaustedError,
  );
  assertEquals(calls, 2);
  assertEquals(err.lastStatus, null);
  assertEquals(err.lastDetail.includes('connection reset'), true);
});

Deno.test('fetchWithRetry: 非暫時性 client 錯誤不重試', async () => {
  let calls = 0;
  await assertRejects(
    () =>
      fetchWithRetry('bad url', {}, {
        source: 'unit',
        sleep: noSleep,
        fetchImpl: async () => { calls += 1; throw new TypeError('Invalid URL'); },
      }),
    TypeError,
  );
  assertEquals(calls, 1);
});

Deno.test('recordRetryFailure: 寫入 function_run_logs 與 data_source_health', async () => {
  const inserted: Record<string, unknown[]> = {};
  const supa = {
    from(table: string) {
      inserted[table] ??= [];
      return {
        insert: async (row: unknown) => { inserted[table].push(row); return { error: null }; },
        upsert: async (row: unknown) => { inserted[table].push(row); return { error: null }; },
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
      };
    },
  };
  const err = new RetryExhaustedError(
    'finmind_bsr',
    [{ attempt: 1, status: 502, waitedMs: 0, elapsedMs: 12 }],
    502,
    'http_502',
    'https://api.finmindtrade.com/api/v4/data?token=secret',
  );
  await recordRetryFailure(supa, err, { fn: 'backfill-worker', runId: 'r1', extra: { stock_id: '2330' } });

  const logs = inserted['function_run_logs'] as any[];
  assertEquals(logs.length, 1);
  assertEquals(logs[0].fn, 'backfill-worker');
  assertEquals(logs[0].level, 'error');
  assertEquals(logs[0].stage, 'upstream_retry_exhausted');
  assertEquals(logs[0].payload.code, 'UPSTREAM_RETRY_EXHAUSTED');
  assertEquals(logs[0].payload.stock_id, '2330');

  const health = inserted['data_source_health'] as any[];
  assertEquals(health.length, 1);
  assertEquals(health[0].source, 'finmind_bsr');
  assertEquals(health[0].last_error_code, 'UPSTREAM_RETRY_EXHAUSTED');
});

Deno.test('recordRetryFailure: supa 為 null 時不 throw', async () => {
  const err = new RetryExhaustedError('x', [], null, 'net', 'https://x.test');
  await recordRetryFailure(null, err, { fn: 'unit' });
});
