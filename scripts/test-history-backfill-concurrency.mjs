import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import pg from 'pg';

// Only the repository's socket-only ephemeral cluster; never environment credentials.
const session = readFileSync('/tmp/bsr-eph-session', 'utf8');
const socket = /^EPH_DIR=(.+)$/m.exec(session)?.[1];
assert(socket?.startsWith('/tmp/bsr-eph-'));
const a = new pg.Client({ host: socket, port: 5432, password: '', user: 'postgres', database: 'bsr_ephemeral' });
const b = new pg.Client({ host: socket, port: 5432, password: '', user: 'postgres', database: 'bsr_ephemeral' });
await a.connect(); await b.connect();
try {
  const guard = await a.query('select current_database() db,inet_server_addr() addr');
  assert.equal(guard.rows[0].db, 'bsr_ephemeral'); assert.equal(guard.rows[0].addr, null);
  await a.query("select public.enqueue_history_backfill(array['990001'])");
  await a.query("insert into public.tw_price_history(symbol,trade_date,close,source) select '990001',(now() at time zone 'Asia/Taipei')::date-d,100,'fixture' from generate_series(1,20) d");
  const claim = (await a.query('select * from public.claim_history_backfill(1)')).rows[0];
  await a.query('begin');
  await a.query("select public.finish_history_backfill($1,$2,'ready')", [claim.symbol, claim.lease_token]);
  const before = (await a.query('select public.history_backfill_status() s')).rows[0].s;
  assert.equal(before.scheduled, false);
  // Enqueue waits behind drain's transaction lock; it must recreate the job after commit.
  const enqueue = b.query("select public.enqueue_history_backfill(array['990002']) s");
  await new Promise(resolve => setTimeout(resolve, 100));
  await a.query('commit');
  const after = (await enqueue).rows[0].s;
  assert.equal(after.remaining, 1); assert.equal(after.scheduled, true);
  console.log('PASS concurrent drain + enqueue: no lost wakeup');

  await a.query("select public.enqueue_history_backfill(array_agg(s::text)) from generate_series(990010,990109) s");
  const [x,y] = await Promise.all([a.query('select * from public.claim_history_backfill(100)'),b.query('select * from public.claim_history_backfill(100)')]);
  assert.equal(x.rows.length,40); assert.equal(y.rows.length,40);
  assert.equal(new Set([...x.rows,...y.rows].map(r=>r.symbol)).size,80);
  console.log('PASS concurrent claims: 40 each, 80 distinct, no duplicate work');
} finally {
  await a.query('rollback');
  await a.query("delete from public.market_data_requests where symbol between '990001' and '990109'");
  await a.query("delete from public.tw_price_history where symbol='990001'");
  await a.end(); await b.end();
}