// source_contract_test.ts
// 靜態源碼守門：tw-chips-orchestrator 的 snapshot 路徑不變量。
//
// 背景：2026-08-12 07:35 UTC production failure —
//   1. materialize_bsr_daily_from_fact 有兩個 overload，只帶 _trade_date 會被
//      PostgREST 判為 ambiguity；必須同時帶 _stock_ids（可為 null）。
//   2. reconcile_snapshot 只吃 _trade_date。
//
// 執行：
//   deno test --allow-read --no-check supabase/functions/tw-chips-orchestrator/source_contract_test.ts

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

const INDEX_PATH = new URL('./index.ts', import.meta.url).pathname;

async function src(): Promise<string> {
  return await Deno.readTextFile(INDEX_PATH);
}

/** 抓出 supa.rpc('<name>', { ... }) 的參數物件字面字串 */
function rpcArgs(source: string, fn: string): string[] {
  const re = new RegExp(
    `rpc\\(\\s*['"\`]${fn}['"\`]\\s*,\\s*(\\{[\\s\\S]*?\\})\\s*,?\\s*\\)`,
    'g',
  );
  const out: string[] = [];
  for (const m of source.matchAll(re)) out.push(m[1]);
  return out;
}

Deno.test('materialize RPC 必須同時帶 _trade_date 與 _stock_ids（避免 overload ambiguity）', async () => {
  const s = await src();
  const calls = rpcArgs(s, 'materialize_bsr_daily_from_fact');
  assertEquals(calls.length, 1, `預期恰好一處 materialize 呼叫，實得 ${calls.length}`);
  const args = calls[0];
  assert(/_trade_date\s*:/.test(args), 'materialize 呼叫缺少 _trade_date');
  assert(
    /_stock_ids\s*:/.test(args),
    'materialize 呼叫缺少 _stock_ids — 只帶單一參數會撞 overload ambiguity',
  );
});

Deno.test('reconcile_snapshot 只帶 _trade_date', async () => {
  const s = await src();
  const calls = rpcArgs(s, 'reconcile_snapshot');
  assertEquals(calls.length, 1, `預期恰好一處 reconcile 呼叫，實得 ${calls.length}`);
  const args = calls[0];
  assert(/_trade_date\s*:/.test(args), 'reconcile_snapshot 呼叫缺少 _trade_date');
  assert(!/_stock_ids\s*:/.test(args), 'reconcile_snapshot 不接受 _stock_ids');
});

Deno.test('orchestrator 不得自行呼叫 lane sync function（單一職責）', async () => {
  const s = await src();
  assert(
    !/functions\.invoke\(\s*['"`]tw-bsr-finmind-sync/.test(s),
    'orchestrator 不得直接 invoke tw-bsr-finmind-sync',
  );
  assert(
    !/functions\.invoke\(\s*['"`]tw-institutional-daily-sync/.test(s),
    'orchestrator 不得直接 invoke tw-institutional-daily-sync',
  );
});
