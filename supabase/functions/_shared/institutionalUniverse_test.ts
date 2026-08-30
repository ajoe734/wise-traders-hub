import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  isCommonStockId,
  filterCommonStockRows,
  deltaUpsertInstitutional,
  acquireSyncLease,
  ZeroYieldStopper,
} from './institutionalUniverse.ts';

Deno.test('isCommonStockId 只收 4 碼普通股', () => {
  for (const ok of ['2330', '1101', '9999', '6505']) {
    assertEquals(isCommonStockId(ok), true, ok);
  }
  for (const bad of ['0050', '00878', '031234', '2891B', '', null, undefined, '233', '23300', 'AAPL']) {
    assertEquals(isCommonStockId(bad as unknown), false, String(bad));
  }
});

Deno.test('filterCommonStockRows 統計被丟掉的列數', () => {
  const { kept, droppedCount } = filterCommonStockRows([
    { stock_id: '2330' }, { stock_id: '0050' }, { stock_id: '031234' }, { stock_id: '6505' },
  ]);
  assertEquals(kept.length, 2);
  assertEquals(droppedCount, 2);
});

function mockSupa(existing: any[], captured: any[]) {
  return {
    from() {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        in: () => Promise.resolve({ data: existing }),
        upsert: (chunk: any[]) => { captured.push(...chunk); return Promise.resolve({ error: null }); },
      };
      return builder;
    },
  };
}

Deno.test('deltaUpsertInstitutional：值沒變不寫', async () => {
  const captured: any[] = [];
  const supa = mockSupa(
    [{ stock_id: '2330', foreign_net: 100, trust_net: 0, dealer_net: 0, total_net: 100 }],
    captured,
  );
  const res = await deltaUpsertInstitutional(
    supa,
    [{ stock_id: '2330', trade_date: '2026-08-29', foreign_net: 100, trust_net: 0, dealer_net: 0, total_net: 100 }],
    { tradeDate: '2026-08-29', source: 'test' },
  );
  assertEquals(res.written, 0);
  assertEquals(res.skipped, 1);
  assertEquals(captured.length, 0);
});

Deno.test('deltaUpsertInstitutional：值有變才寫，且權證/ETF 被擋掉', async () => {
  const captured: any[] = [];
  const supa = mockSupa(
    [{ stock_id: '2330', foreign_net: 100, trust_net: 0, dealer_net: 0, total_net: 100 }],
    captured,
  );
  const res = await deltaUpsertInstitutional(
    supa,
    [
      { stock_id: '2330', trade_date: '2026-08-29', foreign_net: 250, trust_net: 0, dealer_net: 0, total_net: 250 },
      { stock_id: '6505', trade_date: '2026-08-29', foreign_net: 5, trust_net: 0, dealer_net: 0, total_net: 5 },
      { stock_id: '0050', trade_date: '2026-08-29', foreign_net: 9, trust_net: 0, dealer_net: 0, total_net: 9 },
      { stock_id: '031234', trade_date: '2026-08-29', foreign_net: 9, trust_net: 0, dealer_net: 0, total_net: 9 },
    ],
    { tradeDate: '2026-08-29', source: 'test' },
  );
  assertEquals(res.dropped, 2);
  assertEquals(res.written, 2);
  assertEquals(res.skipped, 0);
  assertEquals(captured.map((c) => c.stock_id).sort(), ['2330', '6505']);
});

Deno.test('acquireSyncLease：insert 成功即取得；衝突且未過期則失敗', async () => {
  const okSupa = { from: () => ({ insert: () => Promise.resolve({ error: null }) }) };
  assertEquals(await acquireSyncLease(okSupa, 'k', 60), true);

  const busySupa = {
    from: () => {
      const b: any = {
        insert: () => Promise.resolve({ error: { message: 'duplicate key' } }),
        update: () => b,
        eq: () => b,
        lt: () => b,
        select: () => Promise.resolve({ data: [] }),
      };
      return b;
    },
  };
  assertEquals(await acquireSyncLease(busySupa, 'k', 60), false);
});

// ---------------------------------------------------------------------------
// REV2 — delta 判定必須是 IS DISTINCT FROM 語意
// ---------------------------------------------------------------------------
function makeSupa(existing: any[], writes: any[][]) {
  return {
    from() {
      const node: any = {
        select: () => node,
        eq: () => node,
        in: () => Promise.resolve({ data: existing, error: null }),
        upsert: (chunk: any[]) => { writes.push(chunk); return Promise.resolve({ error: null }); },
      };
      return node;
    },
  } as any;
}

Deno.test('REV2 delta：null vs null 視為相同（不寫）', async () => {
  const writes: any[][] = [];
  const supa = makeSupa(
    [{ stock_id: '2330', foreign_net: null, trust_net: null, dealer_net: null, total_net: null }],
    writes,
  );
  const out = await deltaUpsertInstitutional(
    supa,
    [{ stock_id: '2330', trade_date: '2026-08-29', foreign_net: null, trust_net: null, dealer_net: null, total_net: null }],
    { tradeDate: '2026-08-29', source: 't' },
  );
  assertEquals(out.written, 0);
  assertEquals(out.skipped, 1);
  assertEquals(writes.length, 0);
});

Deno.test('REV2 delta：null vs 0 視為不同（要寫）', async () => {
  const writes: any[][] = [];
  const supa = makeSupa(
    [{ stock_id: '2330', foreign_net: null, trust_net: 0, dealer_net: 0, total_net: 0 }],
    writes,
  );
  const out = await deltaUpsertInstitutional(
    supa,
    [{ stock_id: '2330', trade_date: '2026-08-29', foreign_net: 0, trust_net: 0, dealer_net: 0, total_net: 0 }],
    { tradeDate: '2026-08-29', source: 't' },
  );
  assertEquals(out.written, 1);
  assertEquals(out.skipped, 0);
  assertEquals(writes.length, 1);
});

Deno.test('REV2 delta：字串 "100" 與數字 100 視為相同（型別不造成假變更）', async () => {
  const writes: any[][] = [];
  const supa = makeSupa(
    [{ stock_id: '2330', foreign_net: 100, trust_net: 0, dealer_net: 0, total_net: 100 }],
    writes,
  );
  const out = await deltaUpsertInstitutional(
    supa,
    [{ stock_id: '2330', trade_date: '2026-08-29', foreign_net: '100', trust_net: '0', dealer_net: '0', total_net: '100' }] as any,
    { tradeDate: '2026-08-29', source: 't' },
  );
  assertEquals(out.written, 0);
  assertEquals(out.skipped, 1);
});

Deno.test('REV2 delta：重跑同一批（idempotency）第二次 0 寫入', async () => {
  const rows = [{ stock_id: '2330', trade_date: '2026-08-29', foreign_net: 5, trust_net: 1, dealer_net: 2, total_net: 8 }];
  const writes1: any[][] = [];
  const first = await deltaUpsertInstitutional(makeSupa([], writes1), rows as any, { tradeDate: '2026-08-29', source: 't' });
  assertEquals(first.written, 1);
  const writes2: any[][] = [];
  const second = await deltaUpsertInstitutional(makeSupa(writes1[0], writes2), rows as any, { tradeDate: '2026-08-29', source: 't' });
  assertEquals(second.written, 0);
  assertEquals(writes2.length, 0);
});

// ---------------------------------------------------------------------------
// REV2 — 零新增自停
// ---------------------------------------------------------------------------
Deno.test('ZeroYieldStopper：連續 5 天 0 新增才停', () => {
  const z = new ZeroYieldStopper(5);
  for (let i = 0; i < 4; i++) assertEquals(z.record(0), false);
  assertEquals(z.zeroStreak, 4);
  assertEquals(z.record(1), false, '有寫入必須歸零');
  assertEquals(z.zeroStreak, 0);
  for (let i = 0; i < 4; i++) assertEquals(z.record(0), false);
  assertEquals(z.record(0), true, '第 5 次連續 0 應停止');
  assertEquals(z.shouldStop(), true);
  z.reset();
  assertEquals(z.shouldStop(), false);
});

Deno.test('ZeroYieldStopper：真的有缺口時不會被誤停', () => {
  const z = new ZeroYieldStopper(5);
  for (let i = 0; i < 50; i++) {
    assertEquals(z.record(i % 4 === 0 ? 1200 : 0), false);
  }
});

// ---------------------------------------------------------------------------
// REV2 — cold-start lane 有界且會自停（結構證據）
// ---------------------------------------------------------------------------
Deno.test('tw-institutional-daily-sync cold-start 已接上 ZeroYieldStopper', async () => {
  const src = await Deno.readTextFile(new URL('../tw-institutional-daily-sync/index.ts', import.meta.url));
  assert(src.includes('new ZeroYieldStopper(5)'));
  assert(src.includes('zeroYield.record(0)'), 'already_present 也必須計入 0 新增');
  assert(src.includes('zeroYield.record(inserted)'));
  assert(src.includes('ZERO_YIELD_STOP_REASON'));
  assert(src.includes('acquireSyncLease('), 'keep-warm 必須有租約');
  assert(src.includes('deltaUpsertInstitutional('), '寫入必須走 delta-upsert');
  assert(!src.includes('.upsert(parsed'), '禁止繞過 delta 直接全量 upsert');
});
