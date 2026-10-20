import type { PriceRowInsert, RevenueInsert } from './marketDataStore.ts';

type Db = { rpc: (name: string, args?: Record<string, unknown>) => any; from: (table: string) => any };
type Price = { date: string; open: number; max: number; min: number; close: number; Trading_Volume: number };
type Revenue = { revenue: number; revenue_year: number; revenue_month: number };
type Provider = { prices: (symbol: string) => Promise<Price[]>; revenue: (symbol: string) => Promise<Revenue[]>; isQuota: (error: unknown) => boolean };

async function rpc(db: Db, name: string, args?: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}
async function store(db: Db, table: string, rows: unknown[], onConflict: string) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + 500), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

/** Public worker boundary: DB owns claims, persisted-data validation and cron lifecycle. */
export async function runHistoryBackfill(db: Db, provider: Provider, limit = 40) {
  const queue: Array<{ symbol: string; lease_token: string }> = await rpc(db, 'claim_history_backfill', { p_limit: Math.min(40, limit) }) ?? [];
  const result = { queued: queue.length, done: 0, completedSymbols: [] as string[], failed: [] as Array<{ symbol: string; reason: string }>, stoppedForQuota: false };
  const finish = (row: typeof queue[number], outcome: string, reason: string) => rpc(db, 'finish_history_backfill', { p_symbol: row.symbol, p_token: row.lease_token, p_outcome: outcome, p_reason: reason });
  const started = Date.now();
  for (const row of queue) {
    // Leave enough time to persist progress before the scheduled HTTP timeout.
    if (result.stoppedForQuota || Date.now() - started > 95_000) {
      await finish(row, 'release', result.stoppedForQuota ? '本輪額度耗盡，保留待補' : '本輪時間預算，下一輪續補');
      continue;
    }
    try {
      const px = await provider.prices(row.symbol);
      const prices: PriceRowInsert[] = px.filter((p) => Number.isFinite(Number(p.close)) && Number(p.close) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(p.date))
        .map((p) => ({ symbol: row.symbol, trade_date: p.date, open: Number(p.open) || null, high: Number(p.max) || null, low: Number(p.min) || null, close: Number(p.close), volume: Number(p.Trading_Volume) > 0 ? Number(p.Trading_Volume) : null, source: 'finmind_price' }));
      if (!prices.length) throw new Error('來源無日線資料（可能非上市櫃）');
      // Persist successful prices even if the second provider call exhausts quota.
      await store(db, 'tw_price_history', prices, 'symbol,trade_date');
      const rev = await provider.revenue(row.symbol).catch((e) => { if (provider.isQuota(e)) throw e; return []; });
      const revenues: RevenueInsert[] = rev.filter((r) => Number.isFinite(Number(r.revenue)) && Number(r.revenue) > 0)
        .map((r) => ({ symbol: row.symbol, revenue_year: Number(r.revenue_year), revenue_month: Number(r.revenue_month), revenue: Number(r.revenue), source: 'finmind_month_revenue' }));
      await store(db, 'tw_month_revenue', revenues, 'symbol,revenue_year,revenue_month');
      const saved = await finish(row, 'ready', `日線 ${prices.length} 根、月營收 ${revenues.length} 筆`);
      if (saved?.applied !== true) throw new Error('回補租約已失效，未標完成');
      result.done++;
      result.completedSymbols.push(row.symbol);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      if (provider.isQuota(e)) {
        result.stoppedForQuota = true;
        await finish(row, 'quota', reason);
      } else {
        result.failed.push({ symbol: row.symbol, reason });
        await finish(row, 'failed', reason);
      }
    }
  }
  const status = await rpc(db, 'refresh_history_backfill_schedule');
  return { ...result, status };
}