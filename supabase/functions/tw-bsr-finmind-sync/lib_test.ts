// Unit tests for pure logic in lib.ts.
// 不會連 DB、不會打 FinMind；純函式驗證。
//
// 執行：
//   deno test --allow-env --no-check supabase/functions/tw-bsr-finmind-sync/lib_test.ts

import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  addDays,
  aggregate,
  decideEffectiveDate,
  decideFailureRetry,
  decideQuotaDeferral,
  isQuotaRejection,
  isRecoveryTokenJob,
  partitionTokenFirst,
  isAfterCloseAt,
  isWeekday,
  rollBackToWeekday,
  taipeiNowFrom,
  toIsoDate,
} from './lib.ts';

// 台北時間 2026-07-20 (Mon) 06:00 UTC = 台北 14:00 → 剛好收盤
const MON_0600_UTC = Date.parse('2026-07-20T06:00:00Z');
// 台北時間 2026-07-20 (Mon) 03:00 UTC = 台北 11:00 → 收盤前
const MON_0300_UTC = Date.parse('2026-07-20T03:00:00Z');
// 台北時間 2026-07-19 (Sun) 06:00 UTC = 台北 14:00 週日
const SUN_0600_UTC = Date.parse('2026-07-19T06:00:00Z');

Deno.test('isWeekday - basic', () => {
  assertEquals(isWeekday('2026-07-20'), true);  // Mon
  assertEquals(isWeekday('2026-07-17'), true);  // Fri
  assertEquals(isWeekday('2026-07-18'), false); // Sat
  assertEquals(isWeekday('2026-07-19'), false); // Sun
});

Deno.test('rollBackToWeekday - Sunday rolls back to Friday', () => {
  assertEquals(rollBackToWeekday('2026-07-19'), '2026-07-17'); // Sun → Fri
  assertEquals(rollBackToWeekday('2026-07-18'), '2026-07-17'); // Sat → Fri
  assertEquals(rollBackToWeekday('2026-07-20'), '2026-07-20'); // Mon unchanged
});

Deno.test('addDays', () => {
  assertEquals(addDays('2026-07-20', -1), '2026-07-19');
  assertEquals(addDays('2026-07-20', 3), '2026-07-23');
});

Deno.test('isAfterCloseAt - Taipei 14:00 boundary', () => {
  assertEquals(isAfterCloseAt(MON_0600_UTC), true);   // 14:00 台北 → after close
  assertEquals(isAfterCloseAt(MON_0300_UTC), false);  // 11:00 台北 → before close
});

Deno.test('decideEffectiveDate - 收盤前無指定 → 昨天', () => {
  const taipeiToday = toIsoDate(taipeiNowFrom(MON_0300_UTC));
  assertEquals(taipeiToday, '2026-07-20');
  const r = decideEffectiveDate(MON_0300_UTC, null, taipeiToday);
  assertEquals(r.effective, '2026-07-17'); // 昨天 (Sun) roll back → Fri
  assertEquals(r.rolled, true);
});

Deno.test('decideEffectiveDate - 收盤後無指定 → 今天(交易日)', () => {
  const taipeiToday = toIsoDate(taipeiNowFrom(MON_0600_UTC));
  assertEquals(taipeiToday, '2026-07-20');
  const r = decideEffectiveDate(MON_0600_UTC, null, taipeiToday);
  assertEquals(r.effective, '2026-07-20');
  assertEquals(r.rolled, false);
});

Deno.test('decideEffectiveDate - 非交易日回退', () => {
  const taipeiToday = toIsoDate(taipeiNowFrom(SUN_0600_UTC));
  const r = decideEffectiveDate(SUN_0600_UTC, null, taipeiToday);
  // 週日收盤後 → today 是週日 → roll back to Fri
  assertEquals(r.effective, '2026-07-17');
});

Deno.test('decideEffectiveDate - 使用者指定日期會 roll back 到交易日', () => {
  const r = decideEffectiveDate(MON_0600_UTC, '2026-07-19', '2026-07-20');
  assertEquals(r.effective, '2026-07-17');
  assertEquals(r.rolled, true);
});

Deno.test('aggregate - 同 broker 多筆合併，計算加權均價', () => {
  const rows = [
    { date: '2026-07-18', securities_trader_id: '1234', securities_trader: '元大',
      price: 100, buy: 10, sell: 0, stock_id: '2330' },
    { date: '2026-07-18', securities_trader_id: '1234', securities_trader: '元大',
      price: 110, buy: 10, sell: 5, stock_id: '2330' },
    { date: '2026-07-18', securities_trader_id: '5678', securities_trader: '國泰',
      price: 105, buy: 0, sell: 20, stock_id: '2330' },
  ];
  const agg = aggregate(rows).sort((a, b) => a.broker_id.localeCompare(b.broker_id));
  assertEquals(agg.length, 2);
  assertEquals(agg[0].broker_id, '1234');
  assertEquals(agg[0].buy_shares, 20);
  assertEquals(agg[0].sell_shares, 5);
  assertEquals(agg[0].net_shares, 15);
  assertEquals(agg[0].avg_buy_price, 105); // (100*10 + 110*10) / 20
  assertEquals(agg[0].avg_sell_price, 110);
  assertEquals(agg[1].broker_id, '5678');
  assertEquals(agg[1].net_shares, -20);
  assertEquals(agg[1].avg_buy_price, null); // 0 buy
});

Deno.test('aggregate - 忽略沒有 broker_id 的列', () => {
  const rows = [
    { date: '2026-07-18', securities_trader: '無', price: 1, buy: 1, sell: 0, stock_id: '2330' } as any,
  ];
  assertEquals(aggregate(rows).length, 0);
});

Deno.test('aggregate - 支援 securities_trader_no 舊欄位', () => {
  const rows = [
    { date: '2026-07-18', securities_trader_no: '9999', securities_trader: '舊格式',
      price: 50, buy: 3, sell: 0, stock_id: '2330' },
  ];
  const agg = aggregate(rows);
  assertEquals(agg.length, 1);
  assertEquals(agg[0].broker_id, '9999');
});

Deno.test('decideFailureRetry - 未超上限：指數退避', () => {
  const now = Date.parse('2026-07-20T06:00:00Z');
  const r1 = decideFailureRetry({ attempts: 1, maxAttempts: 5, nowMs: now });
  assertEquals(r1.status, 'pending');
  assertEquals(r1.backoffMinutes, 10); // 2^1 * 5
  assertEquals(r1.nextRunAt, new Date(now + 10 * 60_000).toISOString());

  const r3 = decideFailureRetry({ attempts: 3, maxAttempts: 5, nowMs: now });
  assertEquals(r3.backoffMinutes, 40); // 2^3 * 5
});

Deno.test('decideFailureRetry - 到達上限：failed 且 nextRunAt=null', () => {
  const now = Date.parse('2026-07-20T06:00:00Z');
  const r = decideFailureRetry({ attempts: 5, maxAttempts: 5, nowMs: now });
  assertEquals(r.status, 'failed');
  assertEquals(r.nextRunAt, null);
});

Deno.test('decideFailureRetry - 退避上限 120 分', () => {
  const now = Date.parse('2026-07-20T06:00:00Z');
  const r = decideFailureRetry({ attempts: 10, maxAttempts: 999, nowMs: now });
  assertEquals(r.backoffMinutes, 120); // capped
});

// ============ Build 1：quota 拒絕的轉移語意 ============

Deno.test('isQuotaRejection - 只認 finmind_admission_ 前綴', () => {
  assert(isQuotaRejection('finmind_admission_daily_exhausted'));
  assert(isQuotaRejection('finmind_admission_no_token'));
  assertEquals(isQuotaRejection('finmind_http_429'), false);
  assertEquals(isQuotaRejection('no_chip_data'), false);
  assertEquals(isQuotaRejection(null), false);
  assertEquals(isQuotaRejection(undefined), false);
});

Deno.test('decideQuotaDeferral - 一律 pending，不吃 attempts', () => {
  const now = Date.parse('2026-08-12T07:00:00Z');
  const d = decideQuotaDeferral({ attempts: 3, nowMs: now, jitter: 0 });
  assertEquals(d.status, 'pending');
  assertEquals(d.attemptsAfter, 2); // 抵銷 claim 時的 +1
  assertEquals(d.delayMinutes, 15);
  assertEquals(d.nextRunAt, new Date(now + 15 * 60_000).toISOString());
  assertEquals(d.lastError, 'quota_deferred');
});

Deno.test('decideQuotaDeferral - attempts 抵銷不會變負', () => {
  const now = Date.now();
  assertEquals(decideQuotaDeferral({ attempts: 0, nowMs: now }).attemptsAfter, 0);
  assertEquals(decideQuotaDeferral({ attempts: 1, nowMs: now }).attemptsAfter, 0);
});

Deno.test('decideQuotaDeferral - jitter 邊界落在 15~60 分', () => {
  const now = Date.now();
  for (const j of [-1, 0, 0.5, 1, 2]) {
    const d = decideQuotaDeferral({ attempts: 5, nowMs: now, jitter: j });
    assert(d.delayMinutes >= 15 && d.delayMinutes <= 60, `delay=${d.delayMinutes}`);
  }
});

Deno.test('quota 拒絕永不落入 failed（對比一般失敗路徑）', () => {
  const now = Date.now();
  // 一般失敗：attempts 到頂會 failed（會被 partial unique index 卡死）
  assertEquals(decideFailureRetry({ attempts: 5, maxAttempts: 5, nowMs: now }).status, 'failed');
  // quota 拒絕：即使 attempts 已到頂，仍維持 pending
  assertEquals(decideQuotaDeferral({ attempts: 5, nowMs: now }).status, 'pending');
});

// ============ Build 1f：partitionTokenFirst（stable partition） ============
// deterministic negative control：
//   BSR_PARTITION_IMPL=reversed deno test ... → 以刻意錯誤的實作跑同一組斷言，期望 exit != 0。
// 這個開關只存在於本測試檔（harness 注入點），production source 不含任何分支。
type PJob = { id: number; last_error?: string | null };
const reversedPartition = <T extends { last_error?: string | null }>(jobs: T[]): T[] => {
  const tokens = jobs.filter((j) => j.last_error === 'quota_recovery_token');
  const rest = jobs.filter((j) => j.last_error !== 'quota_recovery_token');
  return rest.concat(tokens.reverse());
};
const partitionUnderTest: <T extends { last_error?: string | null }>(jobs: T[]) => T[] =
  Deno.env.get('BSR_PARTITION_IMPL') === 'reversed' ? reversedPartition : partitionTokenFirst;

const tok = (id: number): PJob => ({ id, last_error: 'quota_recovery_token' });
const nor = (id: number): PJob => ({ id, last_error: null });

Deno.test('partitionTokenFirst - token 在尾端也會被移到第一位', () => {
  const out = partitionUnderTest([nor(1), nor(2), nor(3), tok(9)]);
  assertEquals(out.map((j) => j.id), [9, 1, 2, 3]);
});

Deno.test('partitionTokenFirst - 多個 token：全部前置且保持原相對順序', () => {
  const out = partitionUnderTest([nor(1), tok(7), nor(2), tok(8), nor(3)]);
  assertEquals(out.map((j) => j.id), [7, 8, 1, 2, 3]);
});

Deno.test('partitionTokenFirst - non-token 之間相對順序不變', () => {
  const out = partitionUnderTest([nor(5), nor(4), tok(1), nor(6)]);
  assertEquals(out.map((j) => j.id), [1, 5, 4, 6]);
});

Deno.test('partitionTokenFirst - 無 token 時順序完全不變', () => {
  const input = [nor(3), nor(1), nor(2)];
  const out = partitionUnderTest(input);
  assertEquals(out.map((j) => j.id), [3, 1, 2]);
});

Deno.test('partitionTokenFirst - 空陣列安全', () => {
  assertEquals(partitionUnderTest([] as PJob[]).length, 0);
  assert(Array.isArray(partitionUnderTest([] as PJob[])));
});

Deno.test('isRecoveryTokenJob - 只認 quota_recovery_token', () => {
  assertEquals(isRecoveryTokenJob({ last_error: 'quota_recovery_token' }), true);
  assertEquals(isRecoveryTokenJob({ last_error: 'quota_deferred' }), false);
  assertEquals(isRecoveryTokenJob({ last_error: null }), false);
  assertEquals(isRecoveryTokenJob(null), false);
});
