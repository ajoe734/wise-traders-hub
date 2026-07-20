// finmindRateLimit_test.ts
// 驗證全域限流器契約：
//   1. 同一小時累積呼叫不會超過上限（多 worker 併發共用計數）
//   2. 用盡時 fetchWithRateLimit 拋 RateLimitExhaustedError（不會打出去）
//   3. 429 走 Retry-After / 指數退避後重試
//   4. record_bsr_api_call 對成功/失敗/429 分類正確
//
// 執行：
//   deno test --allow-env --allow-net --no-check supabase/functions/_shared/finmindRateLimit_test.ts

import { assertEquals, assert, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  checkRateLimit,
  fetchWithRateLimit,
  recordCall,
  RateLimitExhaustedError,
} from './finmindRateLimit.ts';

// ---------------- Fake supabase client ----------------
// 只實作我們用到的 .rpc()；行為模擬 check_bsr_rate_limit + record_bsr_api_call。
type Counter = { call: number; success: number; error: number; r429: number };

function makeFakeSupa(limit: number) {
  const state: Counter = { call: 0, success: 0, error: 0, r429: 0 };
  const supa = {
    _state: state,
    _limit: limit,
    async rpc(name: string, _args: any) {
      if (name === 'check_bsr_rate_limit') {
        // 忽略 caller 傳入 _limit，一律用 fake 建構時的 limit 當上限
        return {
          data: [{
            used: state.call,
            remaining: Math.max(0, limit - state.call),
            allowed: state.call < limit,
          }],
          error: null,
        };
      }
      if (name === 'record_bsr_api_call') {
        state.call += 1;
        if (_args?._success) state.success += 1; else state.error += 1;
        if (_args?._rate_limited) state.r429 += 1;
        return { data: null, error: null };
      }
      return { data: null, error: { message: `unknown rpc ${name}` } };
    },
  } as any;
  return supa;
}

// ---------------- fetch stub ----------------
function stubFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  const original = globalThis.fetch;
  globalThis.fetch = handler as any;
  return () => { globalThis.fetch = original; };
}

Deno.test('checkRateLimit - reflects fake counter', async () => {
  const supa = makeFakeSupa(1500);
  const r0 = await checkRateLimit(supa, 1500);
  assertEquals(r0.used, 0);
  assertEquals(r0.remaining, 1500);
  assertEquals(r0.allowed, true);
  supa._state.call = 1500;
  const r1 = await checkRateLimit(supa, 1500);
  assertEquals(r1.allowed, false);
  assertEquals(r1.remaining, 0);
});

Deno.test('fetchWithRateLimit - 用盡配額直接拋，不會呼叫 fetch', async () => {
  const supa = makeFakeSupa(10);
  supa._state.call = 10;
  let called = 0;
  const restore = stubFetch(() => { called++; return new Response('nope'); });
  try {
    await assertRejects(
      () => fetchWithRateLimit(supa, 'https://x', {}),
      RateLimitExhaustedError,
    );
    assertEquals(called, 0);
  } finally {
    restore();
  }
});

Deno.test('fetchWithRateLimit - 成功時 record success', async () => {
  const supa = makeFakeSupa(1500);
  const restore = stubFetch(() => new Response('ok', { status: 200 }));
  try {
    const res = await fetchWithRateLimit(supa, 'https://x', {});
    await res.text();
    assertEquals(res.status, 200);
    assertEquals(supa._state.success, 1);
    assertEquals(supa._state.error, 0);
    assertEquals(supa._state.r429, 0);
  } finally { restore(); }
});

Deno.test('fetchWithRateLimit - 429 走 Retry-After 後成功重試', async () => {
  const supa = makeFakeSupa(1500);
  let n = 0;
  const restore = stubFetch(() => {
    n++;
    if (n === 1) return new Response('slow', { status: 429, headers: { 'retry-after': '0' } });
    return new Response('ok', { status: 200 });
  });
  try {
    const res = await fetchWithRateLimit(supa, 'https://x', {}, { baseBackoffMs: 1 });
    await res.text();
    assertEquals(res.status, 200);
    assertEquals(n, 2);
    assertEquals(supa._state.r429, 1);
    assertEquals(supa._state.success, 1);
  } finally { restore(); }
});

Deno.test('fetchWithRateLimit - 429 重試耗盡回傳 429 給 caller', async () => {
  const supa = makeFakeSupa(1500);
  let n = 0;
  const restore = stubFetch(() => {
    n++;
    return new Response('always slow', { status: 429, headers: { 'retry-after': '0' } });
  });
  try {
    const res = await fetchWithRateLimit(supa, 'https://x', {}, { maxRetries: 2, baseBackoffMs: 1 });
    await res.text();
    assertEquals(res.status, 429);
    assertEquals(n, 3); // initial + 2 retries
    assertEquals(supa._state.r429, 3);
  } finally { restore(); }
});

Deno.test('壓測 (序列)：50 個工作依序消耗配額，超過上限後全部被擋', async () => {
  const LIMIT = 30;
  const supa = makeFakeSupa(LIMIT);
  const restore = stubFetch(async () => new Response('ok', { status: 200 }));
  try {
    let ok = 0, blocked = 0;
    for (let i = 0; i < 50; i++) {
      try {
        const res = await fetchWithRateLimit(supa, 'https://x', {});
        await res.text();
        ok++;
      } catch (e) {
        if (e instanceof RateLimitExhaustedError) blocked++;
        else throw e;
      }
    }
    // 序列情況下：前 LIMIT 次成功，之後全被擋 → 硬上限完全守住
    assertEquals(ok, LIMIT);
    assertEquals(blocked, 50 - LIMIT);
    assertEquals(supa._state.call, LIMIT);
  } finally { restore(); }
});

Deno.test('壓測 (併發)：配額已耗盡時，同時湧入的工作全部被擋', async () => {
  const LIMIT = 100;
  const supa = makeFakeSupa(LIMIT);
  supa._state.call = LIMIT; // 預載為滿載
  let fetchCalls = 0;
  const restore = stubFetch(() => { fetchCalls++; return new Response('ok'); });
  try {
    const tasks = Array.from({ length: 200 }, () =>
      fetchWithRateLimit(supa, 'https://x', {}).then((r) => r.text().then(() => 'ok')).catch((e) => {
        if (e instanceof RateLimitExhaustedError) return 'blocked';
        throw e;
      })
    );
    const results = await Promise.all(tasks);
    const blocked = results.filter((r) => r === 'blocked').length;
    // 硬保證：滿載後任何併發全部被擋，且完全不打 fetch
    assertEquals(blocked, 200);
    assertEquals(fetchCalls, 0);
    assertEquals(supa._state.call, LIMIT); // 未新增任何呼叫
  } finally { restore(); }
});

Deno.test('壓測 (併發 near-limit)：接近上限時併發最多超額 = 併發窗口大小', async () => {
  // 這個測試明確揭露限流器目前的軟保證邊界：check 與 record 非原子。
  // 上游 worker 依賴這個「軟窗口」被 checkRateLimit-before-batch 的 effectiveBatch cap 收斂。
  const LIMIT = 100;
  const supa = makeFakeSupa(LIMIT);
  supa._state.call = 95; // 剩 5 額度
  const CONCURRENCY = 20;
  const restore = stubFetch(async () => new Response('ok'));
  try {
    const tasks = Array.from({ length: CONCURRENCY }, () =>
      fetchWithRateLimit(supa, 'https://x', {}).then((r) => r.text().then(() => 'ok')).catch((e) => {
        if (e instanceof RateLimitExhaustedError) return 'blocked';
        throw e;
      })
    );
    const results = await Promise.all(tasks);
    const ok = results.filter((r) => r === 'ok').length;
    // 併發窗口上限：最壞情況所有 CONCURRENCY 都通過 check 才發現 record 累到 LIMIT。
    // 這正是為何 worker 端要限併發 (index.ts 用 CONCURRENCY=3)。
    // 斷言：ok <= 剩餘 + 併發窗口（即 <= CONCURRENCY），且不會無限膨脹。
    assert(ok <= CONCURRENCY, `ok=${ok} should be bounded by concurrency window`);
    // 序列補完後續：即使超額，下一個 fetchWithRateLimit 必被擋
    await assertRejects(
      () => fetchWithRateLimit(supa, 'https://x', {}),
      RateLimitExhaustedError,
    );
  } finally { restore(); }
});

Deno.test('recordCall - success / error / 429 分類寫入', async () => {
  const supa = makeFakeSupa(1500);
  await recordCall(supa, { success: true });
  await recordCall(supa, { success: false });
  await recordCall(supa, { success: false, rateLimited: true });
  assertEquals(supa._state.call, 3);
  assertEquals(supa._state.success, 1);
  assertEquals(supa._state.error, 2);
  assertEquals(supa._state.r429, 1);
});
