import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  isCommonStockId,
  filterCommonStockRows,
  deltaUpsertInstitutional,
  acquireSyncLease,
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
