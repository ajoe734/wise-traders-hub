// finmindRateLimit_test.ts —— 原子 reservation 版本
//
// 核心保證：任何併發下實際 fetch 次數在滑動 60 分鐘視窗內 ≤ limit。
//
// Fake supa 精準模擬 DB 端 advisory lock 下的原子行為：
//   reserve_bsr_api_quota 內部 (check usage + count active reservations + insert) 皆為
//   同步 JS 執行區塊（不 yield），對應真實 DB 事務的原子性。
//
// 執行：
//   deno test --allow-env --allow-net --no-check supabase/functions/_shared/finmindRateLimit_test.ts

import { assert, assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  checkRateLimit,
  fetchWithRateLimit,
  reserveQuota,
  settleReservation,
  releaseReservation,
  RateLimitExhaustedError,
} from './finmindRateLimit.ts';

// ---------------- Fake Supabase client ----------------
interface Reservation {
  id: number;
  reserved_at: number;
  expires_at: number;
  settled_at: number | null;
  released: boolean;
  success: boolean | null;
  rate_limited: boolean;
}

function makeFakeSupa(limit: number, opts: { windowMs?: number } = {}) {
  const WINDOW = opts.windowMs ?? 60 * 60 * 1000;
  const state = {
    limit,
    now: () => Date.now(),
    reservations: [] as Reservation[],
    usage: [] as { at: number; success: boolean; rate_limited: boolean }[],
    seq: 0,
    stats() {
      const usageCount = this.usage.filter((u) => this.now() - u.at < WINDOW).length;
      const activeRes = this.reservations.filter((r) =>
        !r.settled_at && !r.released && this.now() - r.reserved_at < WINDOW
      ).length;
      return { usageCount, activeRes, total: usageCount + activeRes };
    },
  };

  const rpc = async (name: string, args: any) => {
    // 關鍵：RPC 內部完全同步，不 await 任何東西 → 對應 DB 端 advisory lock 內的原子性
    if (name === 'reserve_bsr_api_quota') {
      // 先過期回收
      for (const r of state.reservations) {
        if (!r.settled_at && !r.released && r.expires_at < state.now()) {
          r.released = true;
          r.settled_at = state.now();
        }
      }
      const { total } = state.stats();
      const cap = args?._limit ?? state.limit;
      if (total >= cap) {
        return { data: [{ reservation_id: null, used: total, remaining: 0, granted: false }], error: null };
      }
      const id = ++state.seq;
      const lease = (args?._lease_seconds ?? 30) * 1000;
      state.reservations.push({
        id,
        reserved_at: state.now(),
        expires_at: state.now() + lease,
        settled_at: null,
        released: false,
        success: null,
        rate_limited: false,
      });
      return {
        data: [{ reservation_id: id, used: total + 1, remaining: cap - total - 1, granted: true }],
        error: null,
      };
    }
    if (name === 'settle_bsr_reservation') {
      const r = state.reservations.find((x) => x.id === args._reservation_id);
      if (!r || r.settled_at || r.released) return { data: null, error: null };
      r.settled_at = state.now();
      r.success = Boolean(args._success);
      r.rate_limited = Boolean(args._rate_limited);
      state.usage.push({ at: state.now(), success: r.success, rate_limited: r.rate_limited });
      return { data: null, error: null };
    }
    if (name === 'release_bsr_reservation') {
      const r = state.reservations.find((x) => x.id === args._reservation_id);
      if (!r || r.settled_at || r.released) return { data: null, error: null };
      r.released = true;
      r.settled_at = state.now();
      return { data: null, error: null };
    }
    if (name === 'check_bsr_rate_limit') {
      const cap = args?._limit ?? state.limit;
      const { total } = state.stats();
      return {
        data: [{ used: total, remaining: Math.max(0, cap - total), allowed: total < cap }],
        error: null,
      };
    }
    return { data: null, error: { message: `unknown rpc ${name}` } };
  };

  return { _state: state, rpc } as any;
}

function stubFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  const orig = globalThis.fetch;
  globalThis.fetch = handler as any;
  return () => { globalThis.fetch = orig; };
}

// ---------------- Basic behaviour ----------------

Deno.test('reserveQuota + settle：counts as usage', async () => {
  const supa = makeFakeSupa(5);
  const r = await reserveQuota(supa, 5);
  assert(r);
  await settleReservation(supa, r!.id, { success: true });
  const s = await checkRateLimit(supa, 5);
  assertEquals(s.used, 1);
  assertEquals(s.remaining, 4);
});

Deno.test('reserveQuota：滿載時回 null 不寫任何 reservation', async () => {
  const supa = makeFakeSupa(2);
  const a = await reserveQuota(supa, 2);
  const b = await reserveQuota(supa, 2);
  const c = await reserveQuota(supa, 2);
  assert(a && b);
  assertEquals(c, null);
  // 未 settle 之前 c 沒有新增 reservation
  assertEquals(supa._state.reservations.length, 2);
});

Deno.test('release：釋放後同一格額度可再度預留', async () => {
  const supa = makeFakeSupa(1);
  const a = await reserveQuota(supa, 1);
  assert(a);
  const b = await reserveQuota(supa, 1);
  assertEquals(b, null);
  await releaseReservation(supa, a!.id);
  const c = await reserveQuota(supa, 1);
  assert(c);
});

// ---------------- fetchWithRateLimit ----------------

Deno.test('fetchWithRateLimit：成功呼叫算入 usage', async () => {
  const supa = makeFakeSupa(10);
  const restore = stubFetch(() => new Response('ok', { status: 200 }));
  try {
    const res = await fetchWithRateLimit(supa, 'https://x', {}, { limit: 10 });
    await res.text();
    assertEquals(res.status, 200);
    assertEquals(supa._state.usage.length, 1);
    assertEquals(supa._state.usage[0].success, true);
  } finally { restore(); }
});

Deno.test('fetchWithRateLimit：滿額直接擋，絕不 fetch', async () => {
  const supa = makeFakeSupa(0);
  let called = 0;
  const restore = stubFetch(() => { called++; return new Response('nope'); });
  try {
    await assertRejects(
      () => fetchWithRateLimit(supa, 'https://x', {}, { limit: 0 }),
      RateLimitExhaustedError,
    );
    assertEquals(called, 0);
    assertEquals(supa._state.reservations.length, 0);
  } finally { restore(); }
});

Deno.test('fetchWithRateLimit：429 走 Retry-After 重試（每次獨立 reservation）', async () => {
  const supa = makeFakeSupa(10);
  let n = 0;
  const restore = stubFetch(() => {
    n++;
    if (n === 1) return new Response('slow', { status: 429, headers: { 'retry-after': '0' } });
    return new Response('ok', { status: 200 });
  });
  try {
    const res = await fetchWithRateLimit(supa, 'https://x', {}, { limit: 10, baseBackoffMs: 1 });
    await res.text();
    assertEquals(res.status, 200);
    assertEquals(n, 2);
    assertEquals(supa._state.usage.length, 2); // 2 次呼叫都算入
    assertEquals(supa._state.usage.filter((u) => u.rate_limited).length, 1);
  } finally { restore(); }
});

Deno.test('fetchWithRateLimit：暫時性網路錯誤會退避重試，每次都獨立結算', async () => {
  const supa = makeFakeSupa(5);
  const restore = stubFetch(() => { throw new Error('connection reset by peer'); });
  try {
    await assertRejects(() =>
      fetchWithRateLimit(supa, 'https://x', {}, { limit: 5, maxRetries: 2, baseBackoffMs: 1 })
    );
    // 1 次原始 + 2 次重試 = 3 個 reservation，全部結算為失敗（不遺留占用）
    assertEquals(supa._state.reservations.length, 3);
    for (const r of supa._state.reservations) {
      assert(r.settled_at);
      assertEquals(r.success, false);
    }
    assertEquals(supa._state.usage.length, 3);
  } finally { restore(); }
});

Deno.test('fetchWithRateLimit：非暫時性錯誤不重試，立即結算', async () => {
  const supa = makeFakeSupa(5);
  const restore = stubFetch(() => { throw new TypeError('Invalid URL'); });
  try {
    await assertRejects(() =>
      fetchWithRateLimit(supa, 'https://x', {}, { limit: 5, maxRetries: 3, baseBackoffMs: 1 })
    );
    assertEquals(supa._state.reservations.length, 1);
    assert(supa._state.reservations[0].settled_at);
    assertEquals(supa._state.reservations[0].success, false);
  } finally { restore(); }
});

Deno.test('fetchWithRateLimit：5xx 也會退避重試後回傳最後一個 response', async () => {
  const supa = makeFakeSupa(5);
  let n = 0;
  const restore = stubFetch(() => { n += 1; return new Response('boom', { status: 502 }); });
  try {
    const res = await fetchWithRateLimit(
      supa,
      'https://x',
      {},
      { limit: 5, maxRetries: 2, baseBackoffMs: 1 },
    );
    assertEquals(res.status, 502);
    assertEquals(n, 3);
    assertEquals(supa._state.reservations.filter((r) => !r.settled_at).length, 0);
  } finally { restore(); }
});

// ---------------- Lease expiry ----------------

Deno.test('Lease expiry：過期 reservation 自動回收，額度可再用', async () => {
  const supa = makeFakeSupa(1);
  const a = await reserveQuota(supa, 1, 1); // 1 秒 lease
  assert(a);
  // 模擬時間跳過
  const origNow = supa._state.now;
  supa._state.now = () => origNow() + 5000;
  try {
    const b = await reserveQuota(supa, 1, 1);
    assert(b, 'expired reservation 應自動回收');
    assertEquals(b!.id, a!.id + 1);
  } finally {
    supa._state.now = origNow;
  }
});

// ---------------- 高併發壓測（核心） ----------------

Deno.test('壓測 A：2000 併發打空桶（limit=100），成功呼叫與 fetch 次數皆 ≤ 100', async () => {
  const LIMIT = 100;
  const supa = makeFakeSupa(LIMIT);
  let fetchCalls = 0;
  const restore = stubFetch(async () => {
    fetchCalls++;
    // 加入 microtask 讓其他 task 有機會交錯
    await Promise.resolve();
    return new Response('ok', { status: 200 });
  });
  try {
    const results = await Promise.all(
      Array.from({ length: 2000 }, () =>
        fetchWithRateLimit(supa, 'https://x', {}, { limit: LIMIT })
          .then((r) => r.text().then(() => 'ok' as const))
          .catch((e) => (e instanceof RateLimitExhaustedError ? 'blocked' as const : 'err' as const)),
      ),
    );
    const ok = results.filter((r) => r === 'ok').length;
    const blocked = results.filter((r) => r === 'blocked').length;
    // 硬性保證：任何併發下都不會超過 LIMIT
    assertEquals(ok, LIMIT, `ok=${ok} 必須等於 LIMIT`);
    assertEquals(fetchCalls, LIMIT, `實際 fetch 次數=${fetchCalls} 必須等於 LIMIT`);
    assertEquals(ok + blocked, 2000);
    assertEquals(supa._state.usage.length, LIMIT);
  } finally { restore(); }
});

Deno.test('壓測 B：near-limit — 桶剩 1，2000 併發湧入只有 1 個能真的 fetch', async () => {
  const LIMIT = 500;
  const supa = makeFakeSupa(LIMIT);
  // 預載 499 筆已結算 usage
  for (let i = 0; i < LIMIT - 1; i++) {
    supa._state.usage.push({ at: supa._state.now(), success: true, rate_limited: false });
  }
  let fetchCalls = 0;
  const restore = stubFetch(async () => {
    fetchCalls++;
    await Promise.resolve();
    return new Response('ok', { status: 200 });
  });
  try {
    const results = await Promise.all(
      Array.from({ length: 2000 }, () =>
        fetchWithRateLimit(supa, 'https://x', {}, { limit: LIMIT })
          .then((r) => r.text().then(() => 'ok' as const))
          .catch((e) => (e instanceof RateLimitExhaustedError ? 'blocked' as const : 'err' as const)),
      ),
    );
    const ok = results.filter((r) => r === 'ok').length;
    assertEquals(ok, 1, `僅剩 1 格額度，實際成功=${ok}`);
    assertEquals(fetchCalls, 1, `實際 fetch=${fetchCalls} 必須 = 1`);
  } finally { restore(); }
});

Deno.test('壓測 C：混合 429／成功；限流器仍不會超額', async () => {
  const LIMIT = 50;
  const supa = makeFakeSupa(LIMIT);
  let n = 0;
  let fetchCalls = 0;
  const restore = stubFetch(async () => {
    fetchCalls++;
    n++;
    await Promise.resolve();
    if (n % 3 === 0) {
      return new Response('slow', { status: 429, headers: { 'retry-after': '0' } });
    }
    return new Response('ok', { status: 200 });
  });
  try {
    // 300 併發任務，每個最多重試 1 次 → 每個任務最多消耗 2 格
    await Promise.all(
      Array.from({ length: 300 }, () =>
        fetchWithRateLimit(supa, 'https://x', {}, { limit: LIMIT, maxRetries: 1, baseBackoffMs: 0 })
          .then((r) => r.text())
          .catch(() => null),
      ),
    );
    // 實際 fetch 次數與已結算 usage 都 ≤ LIMIT（硬保證）
    assert(fetchCalls <= LIMIT, `fetchCalls=${fetchCalls} 不得超過 LIMIT=${LIMIT}`);
    assert(supa._state.usage.length <= LIMIT, `usage=${supa._state.usage.length} 不得超過 LIMIT`);
  } finally { restore(); }
});

Deno.test('壓測 D：release 後額度應完整回填，可再耗盡', async () => {
  const LIMIT = 10;
  const supa = makeFakeSupa(LIMIT);
  // 先預留 LIMIT 個但都 release
  const reservations = await Promise.all(
    Array.from({ length: LIMIT }, () => reserveQuota(supa, LIMIT)),
  );
  for (const r of reservations) {
    assert(r);
    await releaseReservation(supa, r!.id);
  }
  // 應該又能全部預留 LIMIT 個
  const again = await Promise.all(
    Array.from({ length: LIMIT }, () => reserveQuota(supa, LIMIT)),
  );
  assertEquals(again.filter(Boolean).length, LIMIT);
  const overflow = await reserveQuota(supa, LIMIT);
  assertEquals(overflow, null);
});

Deno.test('壓測 E：checkRateLimit 讀值涵蓋 in-flight reservation', async () => {
  const supa = makeFakeSupa(10);
  const r = await reserveQuota(supa, 10);
  assert(r);
  const s = await checkRateLimit(supa, 10);
  assertEquals(s.used, 1); // 未 settle 但也計入
  assertEquals(s.remaining, 9);
});
