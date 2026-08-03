// F1 回歸測試：台股取價瀑布的層級切換、熔斷記錄、降級行為。
// 全部以 fetchImpl 注入假上游，不打真實網路。
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  fetchTwDailyOhlc,
  fetchTwQuotes,
  parseOhlcRow,
  rocToIso,
  dedupeMsgArray,
  codesFromExCh,
  MAX_BARS,
} from './twPriceWaterfall.ts';

const NOW = () => new Date('2026-07-15T00:00:00Z');
const noSleep = () => Promise.resolve();

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function twseRows(n: number) {
  return Array.from({ length: n }, (_, i) => [
    `115/07/${String(i + 1).padStart(2, '0')}`, '1,000', '10,000', '100', '110', '95', '105',
  ]);
}

Deno.test('rocToIso 支援民國與西元', () => {
  assertEquals(rocToIso('115/07/30'), '2026-07-30');
  assertEquals(rocToIso('2026-07-30'), '2026-07-30');
  assertEquals(rocToIso('abc'), undefined);
});

Deno.test('parseOhlcRow 濾掉無效列', () => {
  assertEquals(parseOhlcRow(['115/07/01', '1', '1', '--', '--', '--', '--']), null);
  assertEquals(parseOhlcRow(['115/07/01', '1', '1', '100', '110', '95', '105'])?.close, 105);
});

Deno.test('L1 TWSE 成功時不打 TPEx / FinMind', async () => {
  const hits: string[] = [];
  const res = await fetchTwDailyOhlc('2330', {
    now: NOW,
    sleep: noSleep,
    fetchImpl: ((url: string) => {
      hits.push(new URL(url).hostname);
      return Promise.resolve(jsonRes({ data: twseRows(5) }));
    }) as unknown as typeof fetch,
  });
  assertEquals(res.source, 'twse_stock_day');
  assertEquals(res.bars.length, 5);
  assertEquals(new Set(hits).size, 1);
  assertEquals(hits[0], 'www.twse.com.tw');
});

Deno.test('TWSE 掛掉時降級到 TPEx', async () => {
  const hosts: string[] = [];
  const res = await fetchTwDailyOhlc('6274', {
    now: NOW,
    sleep: noSleep,
    fetchImpl: ((url: string) => {
      const host = new URL(url).hostname;
      hosts.push(host);
      if (host === 'www.twse.com.tw') return Promise.resolve(jsonRes({}, 500));
      return Promise.resolve(jsonRes({ tables: [{ data: twseRows(4) }] }));
    }) as unknown as typeof fetch,
  });
  assertEquals(res.source, 'tpex_daily');
  assertEquals(res.bars.length, 4);
});

Deno.test('TWSE + TPEx 都空時降級到 FinMind（需有 token/supa）', async () => {
  const res = await fetchTwDailyOhlc('3105', {
    now: NOW,
    sleep: noSleep,
    finmindToken: 'tok',
    fetchImpl: ((url: string) => {
      const host = new URL(url).hostname;
      if (host === 'api.finmindtrade.com') {
        return Promise.resolve(jsonRes({
          data: [
            { date: '2026-07-01', open: 10, max: 11, min: 9, close: 10.5 },
            { date: '2026-07-02', open: 10.5, max: 12, min: 10, close: 11 },
          ],
        }));
      }
      return Promise.resolve(jsonRes({ data: [] }));
    }) as unknown as typeof fetch,
  });
  assertEquals(res.source, 'finmind_price');
  assertEquals(res.bars.length, 2);
});

Deno.test('沒有 supa / token 時不會打 FinMind（避免繞過全域配額）', async () => {
  const hosts: string[] = [];
  const res = await fetchTwDailyOhlc('3105', {
    now: NOW,
    sleep: noSleep,
    fetchImpl: ((url: string) => {
      hosts.push(new URL(url).hostname);
      return Promise.resolve(jsonRes({ data: [] }));
    }) as unknown as typeof fetch,
  });
  assertEquals(res.source, null);
  assertEquals(hosts.includes('api.finmindtrade.com'), false);
});

Deno.test('每層成功與失敗都寫入熔斷統計', async () => {
  const events: Array<[string, boolean]> = [];
  await fetchTwDailyOhlc('6274', {
    now: NOW,
    sleep: noSleep,
    recordHealth: (source, ok) => { events.push([source, ok]); return Promise.resolve(); },
    fetchImpl: ((url: string) => {
      const host = new URL(url).hostname;
      if (host === 'www.twse.com.tw') return Promise.resolve(jsonRes({}, 500));
      return Promise.resolve(jsonRes({ tables: [{ data: twseRows(3) }] }));
    }) as unknown as typeof fetch,
  });
  assertEquals(events.some(([s, ok]) => s === 'twse_stock_day' && ok === false), true);
  assertEquals(events.some(([s, ok]) => s === 'tpex_daily' && ok === true), true);
});

Deno.test('最多回傳 MAX_BARS 根（顯示 30 日，判讀壓力需 60 日）', async () => {
  const res = await fetchTwDailyOhlc('2330', {
    now: NOW,
    sleep: noSleep,
    fetchImpl: ((url: string) => {
      // 每個月份回傳不同日期，模擬真實跨月資料
      const m = new URL(url).searchParams.get('date') || '20260715';
      const mm = m.slice(4, 6);
      const rows = Array.from({ length: 25 }, (_, i) => [
        `115/${mm}/${String(i + 1).padStart(2, '0')}`, '1,000', '10,000', '100', '110', '95', '105',
      ]);
      return Promise.resolve(jsonRes({ data: rows }));
    }) as unknown as typeof fetch,
  });
  assertEquals(res.bars.length, MAX_BARS);
});

Deno.test('跨月回補會湊滿 60 日以上並依日期去重排序', async () => {
  const res = await fetchTwDailyOhlc('2330', {
    now: NOW,
    sleep: noSleep,
    fetchImpl: ((url: string) => {
      const m = new URL(url).searchParams.get('date') || '20260715';
      const mm = m.slice(4, 6);
      const rows = Array.from({ length: 20 }, (_, i) => [
        `115/${mm}/${String(i + 1).padStart(2, '0')}`, '2,000', '10,000', '100', '110', '95', '105',
      ]);
      return Promise.resolve(jsonRes({ data: rows }));
    }) as unknown as typeof fetch,
  });
  const dates = res.bars.map((b) => b.date!);
  assertEquals(new Set(dates).size, dates.length);
  assertEquals([...dates].sort().join(',') === dates.join(','), true);
  assertEquals(res.bars.length >= 60, true);
});

Deno.test('TWSE 成交股數直接當股；TPEx 成交仟股要 ×1000', () => {
  assertEquals(parseOhlcRow(['115/07/01', '1,234,000', '1', '100', '110', '95', '105'])?.volume, 1234000);
  assertEquals(parseOhlcRow(['115/07/01', '1,234', '1', '100', '110', '95', '105'], 'lots')?.volume, 1234000);
  // 缺量／零量一律 null，不得補 0
  assertEquals(parseOhlcRow(['115/07/01', '0', '1', '100', '110', '95', '105'])?.volume, null);
  assertEquals(parseOhlcRow(['115/07/01', '--', '1', '100', '110', '95', '105'])?.volume, null);
});

Deno.test('FinMind Trading_Volume 帶進 bar.volume', async () => {
  const res = await fetchTwDailyOhlc('3105', {
    now: NOW,
    sleep: noSleep,
    finmindToken: 'tok',
    fetchImpl: ((url: string) => {
      if (new URL(url).hostname === 'api.finmindtrade.com') {
        return Promise.resolve(jsonRes({
          data: [
            { date: '2026-07-01', open: 10, max: 11, min: 9, close: 10.5, Trading_Volume: 500000 },
            { date: '2026-07-02', open: 10.5, max: 12, min: 10, close: 11, Trading_Volume: 0 },
          ],
        }));
      }
      return Promise.resolve(jsonRes({ data: [] }));
    }) as unknown as typeof fetch,
  });
  assertEquals(res.bars[0].volume, 500000);
  assertEquals(res.bars[1].volume, null);
});

Deno.test('codesFromExCh 解析上市櫃混合', () => {
  assertEquals(codesFromExCh('tse_2330.tw|otc_6274.tw'), ['2330', '6274']);
});

Deno.test('dedupeMsgArray 保留有價那筆', () => {
  const out = dedupeMsgArray([
    { c: '2330', z: '-', v: '0' },
    { c: '2330', z: '1000', v: '5' },
  ]);
  assertEquals(out.length, 1);
  assertEquals(out[0].z, '1000');
});

Deno.test('MIS 掛掉時降級到 TWSE openapi 收盤快照', async () => {
  const res = await fetchTwQuotes('tse_2330.tw', {
    now: NOW,
    sleep: noSleep,
    fetchImpl: ((url: string) => {
      const host = new URL(url).hostname;
      if (host === 'mis.twse.com.tw') return Promise.resolve(jsonRes({}, 502));
      return Promise.resolve(jsonRes([
        { Code: '2330', Name: '台積電', ClosingPrice: '1,100', Change: '10', TradeVolume: '30,000', OpeningPrice: '1,090', HighestPrice: '1,105', LowestPrice: '1,085' },
        { Code: '2317', Name: '鴻海', ClosingPrice: '200', Change: '1', TradeVolume: '10', OpeningPrice: '199', HighestPrice: '201', LowestPrice: '198' },
      ]));
    }) as unknown as typeof fetch,
  });
  assertEquals(res.source, 'twse_openapi');
  assertEquals(res.msgArray.length, 1);
  assertEquals(res.msgArray[0].z, '1100');
  assertEquals(res.msgArray[0].y, '1090');
});

Deno.test('MIS 正常時直接回 MIS 結果', async () => {
  const res = await fetchTwQuotes('tse_2330.tw', {
    now: NOW,
    sleep: noSleep,
    fetchImpl: (() => Promise.resolve(jsonRes({ msgArray: [{ c: '2330', z: '1101', v: '9' }] }))) as unknown as typeof fetch,
  });
  assertEquals(res.source, 'twse_mis');
  assertEquals(res.msgArray[0].z, '1101');
});

Deno.test('兩層都掛時回空且 source 為 null', async () => {
  const res = await fetchTwQuotes('tse_9999.tw', {
    now: NOW,
    sleep: noSleep,
    fetchImpl: (() => Promise.resolve(jsonRes({}, 503))) as unknown as typeof fetch,
  });
  assertEquals(res.source, null);
  assertEquals(res.msgArray.length, 0);
});
