/**
 * checkup-sparkline 收盤對齊 predicate（V2）。
 *
 * 直接讀 edge `index.ts` 的純函式切片並以 `new Function` 執行（沿用
 * `holdings-chips-chunking.test.ts` 的既有 pattern），確保測的是 production
 * 原始碼，而不是複製品。時間全部固定，無未固定 `Date.now()`。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { expectedLatestBsrDate } from '../../../supabase/functions/_shared/tradingDate.ts';

const SRC_PATH = 'supabase/functions/checkup-sparkline/index.ts';
const src = readFileSync(SRC_PATH, 'utf8');

export function slice(name: string): string {
  const m = src.match(
    new RegExp(`// __SLICE_START:${name}\\n([\\s\\S]*?)// __SLICE_END:${name}`),
  );
  if (!m) throw new Error(`slice not found: ${name}`);
  return m[1];
}

const consts = slice('constants');
const classify = new Function(
  `${consts}\n${slice('classifyCacheEntry')}\nreturn classifyCacheEntry;`,
)() as (d: any, expected: string, nowMs: number) => string;

const SETTLE_ALIGN_MS = 5 * 60 * 1000;
const PARTIAL_TTL_MS = 30 * 60 * 1000;

/** 與 index.ts 的 expectedTradeDateFor 同一契約（同一 canonical helper）。 */
const expectedFor = (nowMs: number, holidays?: string[]) =>
  expectedLatestBsrDate(nowMs - SETTLE_ALIGN_MS, holidays);

const ms = (iso: string) => Date.parse(iso);
const bars = (lastDate: string, n = 20) =>
  Array.from({ length: n }, (_, i) => ({
    date: i === n - 1 ? lastDate : `2026-07-${String((i % 28) + 1).padStart(2, '0')}`,
    open: 10, high: 11, low: 9, close: 10, volume: 1000,
  }));

const entry = (lastDate: string, over: Record<string, unknown> = {}) => ({
  ohlc: bars(lastDate),
  closes: bars(lastDate).map((b) => b.close),
  source: 'twse',
  fetched_at: '2026-08-28T04:46:11.913Z',
  complete: true,
  bar_count: 20,
  ...over,
});

describe('checkup-sparkline — canonical expected trade date', () => {
  it('盤中（台北 12:46）expected 仍是上一完整交易日', () => {
    expect(expectedFor(ms('2026-08-28T04:46:00Z'))).toBe('2026-08-27');
  });

  it('收盤後（台北 19:03）expected 是當日', () => {
    expect(expectedFor(ms('2026-08-28T11:03:00Z'))).toBe('2026-08-28');
  });

  it('settle 邊界：14:04 仍是前一日，14:05 起是當日', () => {
    expect(expectedFor(ms('2026-08-28T06:04:00Z'))).toBe('2026-08-27');
    expect(expectedFor(ms('2026-08-28T06:05:00Z'))).toBe('2026-08-28');
  });

  it('週末（週日）roll back 到 08-28', () => {
    expect(expectedFor(ms('2026-08-30T02:00:00Z'))).toBe('2026-08-28');
  });

  it('國定假日 2026-10-09 收盤後 roll back 到 10-08', () => {
    expect(expectedFor(ms('2026-10-09T07:00:00Z'))).toBe('2026-10-08');
  });

  it('注入臨時休市 2026-08-28 → 收盤後 expected 退到 08-27', () => {
    expect(expectedFor(ms('2026-08-28T11:03:00Z'), ['2026-08-28'])).toBe('2026-08-27');
  });
});

describe('checkup-sparkline — classifyCacheEntry', () => {
  it('盤中：lastBar 08-27 對 expected 08-27 → hit_fresh', () => {
    const now = ms('2026-08-28T04:50:00Z');
    expect(classify(entry('2026-08-27'), expectedFor(now), now)).toBe('hit_fresh');
  });

  it('收盤後：lastBar 08-27、cooldown 已過 → refetch', () => {
    const now = ms('2026-08-28T11:03:00Z');
    expect(classify(entry('2026-08-27'), expectedFor(now), now)).toBe('refetch');
  });

  it('收盤後：lastBar 08-28 → hit_fresh', () => {
    const now = ms('2026-08-28T11:03:00Z');
    expect(classify(entry('2026-08-28'), expectedFor(now), now)).toBe('hit_fresh');
  });

  it('收盤後 stale 且在 cooldown 內 → hit_stale_cooldown（0 fetch）', () => {
    const now = ms('2026-08-28T11:03:00Z');
    const d = entry('2026-08-27', {
      last_attempted_at: new Date(now - PARTIAL_TTL_MS + 60_000).toISOString(),
    });
    expect(classify(d, expectedFor(now), now)).toBe('hit_stale_cooldown');
  });

  it('cooldown 恰好到期 → refetch', () => {
    const now = ms('2026-08-28T11:03:00Z');
    const d = entry('2026-08-27', {
      last_attempted_at: new Date(now - PARTIAL_TTL_MS).toISOString(),
    });
    expect(classify(d, expectedFor(now), now)).toBe('refetch');
  });

  it('ohlc < 2 根 → miss', () => {
    const now = ms('2026-08-28T11:03:00Z');
    expect(classify({ ohlc: [{ date: '2026-08-27' }] }, expectedFor(now), now)).toBe('miss');
  });

  it('partial 舊語意不變：complete=false 且超過 30 分 → miss', () => {
    const now = ms('2026-08-28T11:03:00Z');
    const d = entry('2026-08-28', {
      complete: false,
      bar_count: 5,
      ohlc: bars('2026-08-28', 5),
      fetched_at: new Date(now - PARTIAL_TTL_MS - 1000).toISOString(),
    });
    expect(classify(d, expectedFor(now), now)).toBe('miss');
  });

  it('partial 在 TTL 內且已對齊 → hit_fresh', () => {
    const now = ms('2026-08-28T11:03:00Z');
    const d = entry('2026-08-28', {
      complete: false,
      bar_count: 5,
      ohlc: bars('2026-08-28', 5),
      fetched_at: new Date(now - 60_000).toISOString(),
    });
    expect(classify(d, expectedFor(now), now)).toBe('hit_fresh');
  });

  it('舊 entry 無 last_attempted_at → fallback 用 fetched_at 計 cooldown，不 crash', () => {
    const now = ms('2026-08-28T11:03:00Z');
    const recent = entry('2026-08-27', {
      fetched_at: new Date(now - 60_000).toISOString(),
    });
    expect(classify(recent, expectedFor(now), now)).toBe('hit_stale_cooldown');
    const old = entry('2026-08-27', { fetched_at: '2026-08-28T04:46:11.913Z' });
    expect(classify(old, expectedFor(now), now)).toBe('refetch');
  });
});
