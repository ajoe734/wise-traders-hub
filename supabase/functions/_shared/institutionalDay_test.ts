// F4 回歸測試：三大法人單日雙軌抓取（TWSE T86 → FinMind）。
import { assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  parseT86,
  aggregateFinmindMarketDay,
  fetchInstitutionalDay,
  SchemaDriftError,
  toIsoDate,
} from './institutionalDay.ts';

const noSleep = () => Promise.resolve();

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const T86_FIELDS = [
  '證券代號', '證券名稱',
  '外陸資買賣超股數(不含外資自營商)', '外資自營商買賣超股數',
  '投信買賣超股數', '自營商買賣超股數',
  '三大法人買賣超股數',
];
const T86_OK = {
  fields: T86_FIELDS,
  data: [['2330', '台積電', '1,000', '100', '500', '-200', '1,400']],
};

Deno.test('toIsoDate 支援兩種輸入', () => {
  assertEquals(toIsoDate('20260715'), '2026-07-15');
  assertEquals(toIsoDate('2026-07-15'), '2026-07-15');
});

Deno.test('parseT86 依欄位名稱定位並合併外資自營商', () => {
  const rows = parseT86(T86_OK, '2026-07-15');
  assertEquals(rows.length, 1);
  assertEquals(rows[0].foreign_net, 1100);
  assertEquals(rows[0].trust_net, 500);
  assertEquals(rows[0].dealer_net, -200);
  assertEquals(rows[0].total_net, 1400);
});

Deno.test('parseT86 遇到 schema 漂移丟 SchemaDriftError', () => {
  assertThrows(
    () => parseT86({ fields: ['代號', '名稱'], data: [['2330', 'x']] }, '2026-07-15'),
    SchemaDriftError,
  );
});

Deno.test('aggregateFinmindMarketDay 依 stock_id 聚合三類法人', () => {
  const rows = aggregateFinmindMarketDay([
    { stock_id: '2330', name: 'Foreign_Investor', buy: 1000, sell: 100 },
    { stock_id: '2330', name: 'Investment_Trust', buy: 500, sell: 0 },
    { stock_id: '2330', name: 'Dealer_self', buy: 0, sell: 200 },
    { stock_id: '2317', name: 'Investment_Trust', buy: 10, sell: 4 },
  ], '2026-07-15');
  const tsmc = rows.find((r) => r.stock_id === '2330')!;
  assertEquals(tsmc.foreign_net, 900);
  assertEquals(tsmc.trust_net, 500);
  assertEquals(tsmc.dealer_net, -200);
  assertEquals(tsmc.total_net, 1200);
  assertEquals(rows.length, 2);
});

Deno.test('T86 成功時不打 FinMind', async () => {
  const hosts: string[] = [];
  const res = await fetchInstitutionalDay('20260715', {
    finmindToken: 'tok',
    sleep: noSleep,
    fetchImpl: ((url: string) => {
      hosts.push(new URL(url).hostname);
      return Promise.resolve(jsonRes(T86_OK));
    }) as unknown as typeof fetch,
  });
  assertEquals(res.source, 'twse_t86');
  assertEquals(res.rows.length, 1);
  assertEquals(hosts.includes('api.finmindtrade.com'), false);
});

Deno.test('T86 掛掉時降級到 FinMind（F4 雙軌）', async () => {
  const res = await fetchInstitutionalDay('20260715', {
    finmindToken: 'tok',
    sleep: noSleep,
    fetchImpl: ((url: string) => {
      if (new URL(url).hostname === 'www.twse.com.tw') return Promise.resolve(jsonRes({}, 500));
      return Promise.resolve(jsonRes({
        data: [{ stock_id: '2330', name: 'Foreign_Investor', buy: 10, sell: 4, date: '2026-07-15' }],
      }));
    }) as unknown as typeof fetch,
  });
  assertEquals(res.source, 'finmind_institutional');
  assertEquals(res.rows[0].foreign_net, 6);
});

Deno.test('T86 schema 漂移也會降級到 FinMind', async () => {
  const res = await fetchInstitutionalDay('20260715', {
    finmindToken: 'tok',
    sleep: noSleep,
    fetchImpl: ((url: string) => {
      if (new URL(url).hostname === 'www.twse.com.tw') {
        return Promise.resolve(jsonRes({ fields: ['代號'], data: [['2330']] }));
      }
      return Promise.resolve(jsonRes({
        data: [{ stock_id: '2454', name: 'Investment_Trust', buy: 5, sell: 1 }],
      }));
    }) as unknown as typeof fetch,
  });
  assertEquals(res.source, 'finmind_institutional');
  assertEquals(res.attempts[0].reason, 'SCHEMA_DRIFT');
});

Deno.test('兩軌都無資料時 source 為 null 且不 throw', async () => {
  const res = await fetchInstitutionalDay('20260715', {
    finmindToken: 'tok',
    sleep: noSleep,
    fetchImpl: (() => Promise.resolve(jsonRes({ data: [] }))) as unknown as typeof fetch,
  });
  assertEquals(res.source, null);
  assertEquals(res.rows.length, 0);
  assertEquals(res.attempts.length, 2);
});

Deno.test('沒有 supa / token 時不打 FinMind（不繞過配額治理）', async () => {
  const hosts: string[] = [];
  const res = await fetchInstitutionalDay('20260715', {
    sleep: noSleep,
    fetchImpl: ((url: string) => {
      hosts.push(new URL(url).hostname);
      return Promise.resolve(jsonRes({ data: [] }));
    }) as unknown as typeof fetch,
  });
  assertEquals(res.source, null);
  assertEquals(hosts.includes('api.finmindtrade.com'), false);
});

Deno.test('每軌都寫熔斷統計', async () => {
  const events: Array<[string, boolean]> = [];
  await fetchInstitutionalDay('20260715', {
    finmindToken: 'tok',
    sleep: noSleep,
    recordHealth: (s, ok) => { events.push([s, ok]); return Promise.resolve(); },
    fetchImpl: ((url: string) => {
      if (new URL(url).hostname === 'www.twse.com.tw') return Promise.resolve(jsonRes({}, 503));
      return Promise.resolve(jsonRes({ data: [{ stock_id: '2330', name: 'Investment_Trust', buy: 3, sell: 1 }] }));
    }) as unknown as typeof fetch,
  });
  assertEquals(events.some(([s, ok]) => s === 'twse_t86' && !ok), true);
  assertEquals(events.some(([s, ok]) => s === 'finmind_institutional' && ok), true);
});
