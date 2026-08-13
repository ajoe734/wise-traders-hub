// Build2 P4 — fulfillDay E2E（mocked Supabase client）
// deno test -A supabase/functions/_shared/snapshotFulfillment_test.ts
//
// 覆蓋介面：claim → aggregate → tw_chip_fact upsert → materialize_bsr_daily_from_fact
//          → rebuild_bsr_rollup → bsr_snapshot_mark → bsr_snapshot_fulfill_jobs
// 以及失敗分支：未 claim、fact upsert 失敗、materialize 失敗、sealed skip。

import { assert, assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { fulfillDay, persistAggregated, snapshotSourceToLane } from './snapshotFulfillment.ts';

type Call = { kind: string; name: string; payload: unknown };

interface StubOpts {
  claimed?: boolean;
  prevStatus?: string;
  factError?: string | null;
  materializeError?: string | null;
  materialized?: number;
  skippedSealed?: boolean;
  rollupError?: string | null;
  fulfilled?: number;
  stillPending?: number;
}

function makeSupa(opts: StubOpts = {}) {
  const calls: Call[] = [];
  const supa = {
    rpc(name: string, payload: unknown) {
      calls.push({ kind: 'rpc', name, payload });
      switch (name) {
        case 'bsr_snapshot_claim':
          return Promise.resolve({
            data: [{
              claimed: opts.claimed ?? true,
              prev_status: opts.prevStatus ?? 'pending',
              attempt_count: 1,
            }],
            error: null,
          });
        case 'materialize_bsr_daily_from_fact':
          return Promise.resolve(
            opts.materializeError
              ? { data: null, error: { message: opts.materializeError } }
              : {
                data: [{
                  materialized_rows: opts.materialized ?? 3,
                  skipped_sealed: opts.skippedSealed ?? false,
                }],
                error: null,
              },
          );
        case 'rebuild_bsr_rollup':
          return Promise.resolve(
            opts.rollupError
              ? { data: null, error: { message: opts.rollupError } }
              : { data: null, error: null },
          );
        case 'bsr_snapshot_mark':
          return Promise.resolve({ data: null, error: null });
        case 'bsr_snapshot_fulfill_jobs':
          return Promise.resolve({
            data: [{
              fulfilled: opts.fulfilled ?? 2,
              still_pending: opts.stillPending ?? 0,
            }],
            error: null,
          });
        default:
          throw new Error(`unexpected rpc: ${name}`);
      }
    },
    from(table: string) {
      return {
        upsert(rows: unknown, cfg: unknown) {
          calls.push({ kind: 'upsert', name: table, payload: { rows, cfg } });
          return Promise.resolve(
            opts.factError ? { error: { message: opts.factError } } : { error: null },
          );
        },
      };
    },
  };
  // deno-lint-ignore no-explicit-any
  return { supa: supa as any, calls };
}

// FinMind market-batch raw rows（兩檔、每檔兩分點、含同分點多列需被 aggregate 合併）
const RAW = [
  { stock_id: '2330', date: '2026-08-13', securities_trader_id: '1234', securities_trader: '甲券', buy: 100, sell: 0, price: 10 },
  { stock_id: '2330', date: '2026-08-13', securities_trader_id: '1234', securities_trader: '甲券', buy: 50, sell: 20, price: 12 },
  { stock_id: '2330', date: '2026-08-13', securities_trader_id: '5678', securities_trader: '乙券', buy: 0, sell: 70, price: 11 },
  { stock_id: '2317', date: '2026-08-13', securities_trader_id: '1234', securities_trader: '甲券', buy: 30, sell: 10, price: 5 },
  // deno-lint-ignore no-explicit-any
] as any[];

Deno.test('snapshotSourceToLane: market batch → finmind_batch，其餘 → finmind_per_stock', () => {
  assertEquals(snapshotSourceToLane('finmind_market_batch'), 'finmind_batch');
  assertEquals(snapshotSourceToLane('finmind_per_stock'), 'finmind_per_stock');
  assertEquals(snapshotSourceToLane('manual'), 'finmind_per_stock');
});

Deno.test('fulfillDay happy path：完整鏈路呼叫順序與 coverage', async () => {
  const { supa, calls } = makeSupa({ fulfilled: 2, stillPending: 0 });
  const out = await fulfillDay(supa, '2026-08-13', 'cid-1', RAW, 'finmind_market_batch');

  assertEquals(out.claimed, true);
  assertEquals(out.final_status, 'ready');
  assertEquals(out.coverage_stocks, 2);
  assertEquals(out.jobs_fulfilled, 2);
  assertEquals(out.jobs_still_pending, 0);

  const order = calls.map((c) => `${c.kind}:${c.name}`);
  assertEquals(order, [
    'rpc:bsr_snapshot_claim',
    'upsert:tw_chip_fact',
    'rpc:materialize_bsr_daily_from_fact',
    'rpc:rebuild_bsr_rollup',
    'rpc:bsr_snapshot_mark',
    'rpc:bsr_snapshot_fulfill_jobs',
  ]);
});

Deno.test('fulfillDay：fact 列 lane 標記為 finmind_batch 且不得寫 net_shares（generated 欄位）', async () => {
  const { supa, calls } = makeSupa();
  await fulfillDay(supa, '2026-08-13', 'cid-2', RAW, 'finmind_market_batch');
  const up = calls.find((c) => c.kind === 'upsert')!;
  // deno-lint-ignore no-explicit-any
  const { rows, cfg } = up.payload as any;
  assertEquals(cfg.onConflict, 'stock_id,trade_date,broker_id,source');
  assertEquals(rows.length, 3); // 2330×2 分點 + 2317×1 分點（同分點多列已合併）
  for (const r of rows) {
    assertEquals(r.source, 'finmind_batch');
    assert(!('net_shares' in r), 'net_shares 不可寫入');
    assertEquals(r.trade_date, '2026-08-13');
    assert(typeof r.ingested_at === 'string');
  }
  const t2330 = rows.filter((r: { stock_id: string }) => r.stock_id === '2330');
  const b1234 = t2330.find((r: { broker_id: string }) => r.broker_id === '1234');
  assertEquals(b1234.buy_shares, 150);
  assertEquals(b1234.sell_shares, 20);
});

Deno.test('fulfillDay：rollup 以觸及個股分批呼叫，_as_of 為該交易日', async () => {
  const { supa, calls } = makeSupa();
  await fulfillDay(supa, '2026-08-13', 'cid-3', RAW, 'finmind_market_batch');
  const roll = calls.filter((c) => c.name === 'rebuild_bsr_rollup');
  assertEquals(roll.length, 1);
  // deno-lint-ignore no-explicit-any
  const p = roll[0].payload as any;
  assertEquals(p._as_of, '2026-08-13');
  assertEquals([...p._stock_ids].sort(), ['2317', '2330']);
});

Deno.test('fulfillDay：未 claim 到（他人持有 / 已 ready）即短路，不寫任何資料', async () => {
  const { supa, calls } = makeSupa({ claimed: false, prevStatus: 'ready' });
  const out = await fulfillDay(supa, '2026-08-13', 'cid-4', RAW, 'finmind_market_batch');
  assertEquals(out.final_status, 'skipped_not_claimed');
  assertEquals(out.claimed, false);
  assertEquals(out.prev_status, 'ready');
  assertEquals(calls.map((c) => c.name), ['bsr_snapshot_claim']);
});

Deno.test('fulfillDay：空 rawRows → partial，不得標成 ready', async () => {
  const { supa, calls } = makeSupa({ materialized: 0, fulfilled: 0, stillPending: 7 });
  const out = await fulfillDay(supa, '2026-08-13', 'cid-5', [], 'finmind_market_batch');
  assertEquals(out.final_status, 'partial');
  assertEquals(out.coverage_stocks, 0);
  const mark = calls.find((c) => c.name === 'bsr_snapshot_mark')!;
  // deno-lint-ignore no-explicit-any
  assertEquals((mark.payload as any)._status, 'partial');
});

Deno.test('fulfillDay：fact upsert 失敗 → mark failed 並向上拋', async () => {
  const { supa, calls } = makeSupa({ factError: 'boom-fact' });
  await assertRejects(
    () => fulfillDay(supa, '2026-08-13', 'cid-6', RAW, 'finmind_market_batch'),
    Error,
    'chip_fact_upsert_failed:boom-fact',
  );
  const mark = calls.find((c) => c.name === 'bsr_snapshot_mark')!;
  // deno-lint-ignore no-explicit-any
  const p = mark.payload as any;
  assertEquals(p._status, 'failed');
  assertEquals(p._coverage_stocks, 0);
  assert(String(p._last_error).includes('chip_fact_upsert_failed'));
  assert(!calls.some((c) => c.name === 'bsr_snapshot_fulfill_jobs'));
});

Deno.test('fulfillDay：materialize 失敗 → mark failed 並向上拋', async () => {
  const { supa, calls } = makeSupa({ materializeError: 'timeout' });
  await assertRejects(
    () => fulfillDay(supa, '2026-08-13', 'cid-7', RAW, 'finmind_market_batch'),
    Error,
    'materialize_failed:timeout',
  );
  // deno-lint-ignore no-explicit-any
  assertEquals((calls.find((c) => c.name === 'bsr_snapshot_mark')!.payload as any)._status, 'failed');
});

Deno.test('persistAggregated：snapshot 已封存 → skipped_sealed 透傳，仍回報 stocks/rows', async () => {
  const { supa } = makeSupa({ materialized: 0, skippedSealed: true });
  const agg = [
    { stock_id: '2330', trade_date: '2026-08-13', broker_id: '1', broker_name: 'a', buy_shares: 1, sell_shares: 0, avg_buy_price: 1, avg_sell_price: null },
    // deno-lint-ignore no-explicit-any
  ] as any[];
  const out = await persistAggregated(supa, '2026-08-13', agg, 'finmind_batch');
  assertEquals(out.skipped_sealed, true);
  assertEquals(out.materialized, 0);
  assertEquals(out.stocks, 1);
  assertEquals(out.rows, 1);
});

Deno.test('persistAggregated：rollup 失敗 → chips_rollup_upsert_failed', async () => {
  const { supa } = makeSupa({ rollupError: 'nope' });
  const agg = [
    { stock_id: '2330', trade_date: '2026-08-13', broker_id: '1', broker_name: 'a', buy_shares: 1, sell_shares: 0, avg_buy_price: 1, avg_sell_price: null },
    // deno-lint-ignore no-explicit-any
  ] as any[];
  await assertRejects(
    () => persistAggregated(supa, '2026-08-13', agg, 'finmind_batch'),
    Error,
    'chips_rollup_upsert_failed:nope',
  );
});
