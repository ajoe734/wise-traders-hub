/**
 * checkup-sparkline retry cooldown（V2）— provider 呼叫次數與 upsert 決策。
 *
 * 使用 edge `index.ts` 真實純函式切片（planCacheDecisions / classifyCacheEntry /
 * buildUpsertRow / entryFromData）組成的請求模擬器，搭配 fake provider 與 fake
 * storage 兩個 double。時間全部固定。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { coalesce } from '../../../supabase/functions/_shared/requestCoalescer.ts';
import { buildConfirmedClose } from '@/checkup/lib/confirmedClose';
import { setMarketHolidays, resetMarketHolidays } from '@/checkup/lib/marketCalendar';

const SRC_PATH = 'supabase/functions/checkup-sparkline/index.ts';
const src = readFileSync(SRC_PATH, 'utf8');

function slice(name: string): string {
  const m = src.match(
    new RegExp(`// __SLICE_START:${name}\\n([\\s\\S]*?)// __SLICE_END:${name}`),
  );
  if (!m) throw new Error(`slice not found: ${name}`);
  return m[1];
}

const api = new Function(`
${slice('constants')}
${slice('classifyCacheEntry')}
${slice('buildUpsertRow')}
${slice('entryFromData')}
${slice('planCacheDecisions')}
return { classifyCacheEntry, buildUpsertRow, entryFromData, planCacheDecisions };
`)() as {
  classifyCacheEntry: (d: any, expected: string, nowMs: number) => string;
  buildUpsertRow: (prev: any, next: any, nowIso: string) => any;
  entryFromData: (d: any) => any;
  planCacheDecisions: (codes: string[], rows: Map<string, any>, expected: string, nowMs: number) => any;
};

const PARTIAL_TTL_MS = 30 * 60 * 1000;
const EXPECTED = '2026-08-28'; // 收盤後的 canonical latest completed trade date

const bars = (lastDate: string, n = 20) =>
  Array.from({ length: n }, (_, i) => ({
    date: i === n - 1 ? lastDate : `2026-07-${String((i % 28) + 1).padStart(2, '0')}`,
    open: 10, high: 11, low: 9, close: 10, volume: 1000,
  }));

const staleCache = (over: Record<string, unknown> = {}) => ({
  ohlc: bars('2026-08-27'),
  closes: bars('2026-08-27').map((b) => b.close),
  source: 'twse',
  fetched_at: '2026-08-28T04:46:11.913Z',
  complete: true,
  bar_count: 20,
  ...over,
});

/** 一次請求：回傳 { result, providerCalls, store }。 */
function runRequest(opts: {
  codes: string[];
  store: Map<string, any>;
  nowMs: number;
  provider: (code: string) => { bars: any[]; source?: string | null; complete?: boolean };
}) {
  const { codes: raw, store, nowMs, provider } = opts;
  const codes = Array.from(new Set(raw)); // 同 request 去重
  const nowIso = new Date(nowMs).toISOString();
  let providerCalls = 0;

  const plan = api.planCacheDecisions(codes, store, EXPECTED, nowMs);
  const result: Record<string, any> = {};
  for (const [c, d] of plan.serve) result[c] = api.entryFromData(d);

  for (const c of plan.toFetch) {
    providerCalls += 1;
    const r = provider(c);
    const prev = plan.prev.get(c) ?? null;
    const row = api.buildUpsertRow(
      prev,
      { ohlc: r.bars || [], source: r.source ?? null, complete: r.complete === true },
      nowIso,
    );
    if ((r.bars || []).length >= 2) result[c] = api.entryFromData(row);
    else if (prev) result[c] = api.entryFromData(prev);
    else result[c] = { ohlc: [], closes: [], tradeDate: null, complete: false };
    if (row) store.set(c, row);
  }
  return { result, providerCalls, cooldownServed: plan.cooldownServed };
}

const t0 = Date.parse('2026-08-28T11:03:00Z');

describe('checkup-sparkline — retry cooldown', () => {
  it('provider 失敗後 30 分鐘內第二請求 provider count = 0', () => {
    const store = new Map<string, any>([['039108', staleCache()]]);
    const fail = () => ({ bars: [] as any[] });

    const first = runRequest({ codes: ['039108'], store, nowMs: t0, provider: fail });
    expect(first.providerCalls).toBe(1);
    expect(store.get('039108').last_attempted_at).toBe(new Date(t0).toISOString());

    const second = runRequest({
      codes: ['039108'], store, nowMs: t0 + 29 * 60_000, provider: fail,
    });
    expect(second.providerCalls).toBe(0);
    expect(second.cooldownServed).toBe(1);
  });

  it('30 分鐘後恰 1 次 provider 呼叫', () => {
    const store = new Map<string, any>([['039108', staleCache()]]);
    const fail = () => ({ bars: [] as any[] });
    runRequest({ codes: ['039108'], store, nowMs: t0, provider: fail });
    const third = runRequest({
      codes: ['039108'], store, nowMs: t0 + 31 * 60_000, provider: fail,
    });
    expect(third.providerCalls).toBe(1);
  });

  it('provider 成功但回舊日 → 也進 cooldown', () => {
    const store = new Map<string, any>([['039108', staleCache()]]);
    const stillOld = () => ({ bars: bars('2026-07-02'), source: 'finmind', complete: true });

    const first = runRequest({ codes: ['039108'], store, nowMs: t0, provider: stillOld });
    expect(first.providerCalls).toBe(1);
    expect(first.result['039108'].tradeDate).toBe('2026-07-02');

    const second = runRequest({
      codes: ['039108'], store, nowMs: t0 + 10 * 60_000, provider: stillOld,
    });
    expect(second.providerCalls).toBe(0);
  });

  it('failure marker 不改寫 factual metadata（逐欄相等）', () => {
    const before = staleCache();
    const store = new Map<string, any>([['039108', before]]);
    runRequest({ codes: ['039108'], store, nowMs: t0, provider: () => ({ bars: [] }) });
    const after = store.get('039108');

    expect(after.ohlc).toEqual(before.ohlc);
    expect(after.closes).toEqual(before.closes);
    expect(after.source).toBe(before.source);
    expect(after.fetched_at).toBe(before.fetched_at);
    expect(after.complete).toBe(before.complete);
    expect(after.bar_count).toBe(before.bar_count);
    expect(after.last_attempted_at).toBe(new Date(t0).toISOString());
  });

  it('provider 全失敗時 response 誠實 stale → 前端判 pending / stale_trade_date', () => {
    const store = new Map<string, any>([['039108', staleCache()]]);
    const { result } = runRequest({
      codes: ['039108'], store, nowMs: t0, provider: () => ({ bars: [] }),
    });
    const entry = result['039108'];
    expect(entry.tradeDate).toBe('2026-08-27');
    expect(entry.fetchedAt).toBe('2026-08-28T04:46:11.913Z');

    setMarketHolidays([]);
    try {
      const cc = buildConfirmedClose('039108', entry, {
        now: new Date('2026-08-28T11:03:00Z'),
      });
      expect(cc.state).toBe('pending');
      expect(cc.reason).toBe('stale_trade_date');
      expect(cc.tradeDate).toBe('2026-08-27');
    } finally {
      resetMarketHolidays();
    }
  });

  it('同一 request 內重複代號只抓一次', () => {
    const store = new Map<string, any>();
    const { providerCalls } = runRequest({
      codes: ['2330', '2330', '2317'],
      store,
      nowMs: t0,
      provider: () => ({ bars: bars('2026-08-28'), source: 'twse', complete: true }),
    });
    expect(providerCalls).toBe(2);
  });

  it('同 isolate coalesce：同 key 併發只打一次 provider', async () => {
    let calls = 0;
    const factory = async () => { calls += 1; return { bars: bars('2026-08-28') }; };
    const key = `sparkline:2330:${EXPECTED}`;
    await Promise.all([coalesce(key, factory), coalesce(key, factory)]);
    expect(calls).toBe(1);
  });

  it('index.ts 確實以 coalesce 包住 provider 呼叫', () => {
    expect(src).toMatch(/coalesce\(\s*`sparkline:\$\{c\}:\$\{expected\}`/);
    expect(src).toMatch(/fetchTwDailyOhlc\(c, \{ supa: sb as any \}\)/);
  });
});
