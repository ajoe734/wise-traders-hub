import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dailyFinmindUsage, usageWindow, quotaState, loadFinmindJobs, type FinmindJob, type QuotaObservation } from '@/lib/finmindUsage';
const now = new Date('2026-10-18T20:43:00Z');
const job = (detail: Record<string, unknown>, job_name = 'market_data_sync', ran_at = now.toISOString()): FinmindJob => ({ detail, job_name, ran_at });
const q = (remaining: number | null, quota_limit: number | null = 1000): QuotaObservation => ({ source: 'finmind_fs', remaining, quota_limit, reset_at: null, observed_at: now.toISOString() });
describe('每日財報用量', () => {
  it('台北零時分日，涵蓋14個日期', () => {
    const days = dailyFinmindUsage([job({ mode: 'backfill', done: 1, completedSymbols: ['2330'] }, undefined, '2026-10-18T15:59:59Z'), job({ mode: 'backfill', done: 2, completedSymbols: ['2330','2317'] }, undefined, '2026-10-18T16:00:00Z')], now);
    expect(days).toHaveLength(14); expect(days[0].day).toBe('2026-10-19'); expect(days[0].history).toBe(2); expect(days[1].history).toBe(1);
    expect(usageWindow(now)).toBe('2026-10-05T16:00:00.000Z');
  });
  it('跨任務與重試去重，檔次分開，不以API數或排隊數代替', () => {
    const [d] = dailyFinmindUsage([job({ mode: 'backfill', done: 2, queued: 40, completedSymbols: ['2330','2317'] }), job({ mode: 'basis', ok: 1, completedSymbols: ['2330'] }, 'valuation_ps_sync')], now);
    expect(d.unique).toBe(2); expect(d.history).toBe(2); expect(d.filings).toBe(1);
  });
  it('官方每日行情、月營收與其他任務不計FinMind抓取', () => {
    const [d] = dailyFinmindUsage([job({ mode: 'daily', done: 2000 }), job({ mode: 'revenue', done: 1976 }), job({ mode: 'basis', ok: 50 }, 'other')], now);
    expect(d.unique).toBe(0); expect(d.filings).toBe(0); expect(d.history).toBe(0);
  });
  it('舊紀錄顯示檔次但未知獨立檔數，耗盡以實際停止計', () => {
    const [d] = dailyFinmindUsage([job({ mode: 'backfill', done: 40, stoppedForQuota: true }), job({ mode: 'basis', ok: 2, completedSymbols: ['2330'] }, 'valuation_ps_sync')], now);
    expect(d.unique).toBeNull(); expect(d.history).toBe(40); expect(d.stops).toBe(1);
  });
  it('失敗零完成不影響獨立檔數；空日期為零', () => {
    const days = dailyFinmindUsage([job({ mode: 'backfill', done: 0, failed: [{ symbol:'2330' }] })], now);
    expect(days[0].unique).toBe(0); expect(days[1].unique).toBe(0);
  });
  it('讀取完整1000列以後頁面且分頁失敗不能當零', async () => {
    const row = job({ mode: 'backfill', done: 1 });
    const offsets: number[] = [];
    const data = await loadFinmindJobs(async offset => { offsets.push(offset); return { data: Array.from({ length: offset ? 1 : 1000 }, () => row), error: null }; });
    expect(data).toHaveLength(1001); expect(offsets).toEqual([0,1000]);
    await expect(loadFinmindJobs(async () => ({ data: null, error: new Error('denied') }))).rejects.toThrow('denied');
  });
});
describe('剩餘額度預警', () => {
  it.each([[201,'normal'],[200,'warning'],[101,'warning'],[100,'critical'],[1,'critical'],[0,'exhausted']] as const)('剩餘 %s', (remaining, state) => expect(quotaState(q(remaining), now.getTime())).toBe(state));
  it('沒有上游剩餘或上限不以內部配額推估', () => {
    expect(quotaState(q(null), now.getTime())).toBe('unknown'); expect(quotaState(q(100,null), now.getTime())).toBe('unknown'); expect(quotaState(q(-1), now.getTime())).toBe('unknown');
  });
  it('一小時有效邊界，已到重置時間的觀測不可當當前量', () => {
    expect(quotaState(q(100), now.getTime()+3600000)).toBe('critical'); expect(quotaState(q(100), now.getTime()+3600001)).toBe('stale');
    expect(quotaState({ ...q(100), reset_at: now.toISOString() }, now.getTime())).toBe('stale');
  });
});
describe('財報抓取紀錄各完成分支', () => {
  for (const name of ['market-data-sync','valuation-ps-sync']) it(`${name} 記錄上游與成功代碼`, () => {
    const source = readFileSync(`supabase/functions/${name}/index.ts`, 'utf8');
    expect(source).toContain('await recordUpstreamQuota(');
    expect(source).toContain('completedSymbols: []');
    const successes = source.match(/result\.(done|ok)\+\+/g) ?? [];
    const records = source.match(/result\.completedSymbols\.push\(symbol\)/g) ?? [];
    expect(records.length).toBe(successes.length); expect(records.length).toBeGreaterThan(0);
  });
});