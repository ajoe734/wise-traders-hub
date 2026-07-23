// _shared/snapshotFulfillment.ts
// M3 v2 — L2 Snapshot-First orchestration.
//
// A `trade_date` is the atomic unit of BSR truth. This module owns the state
// machine (bsr_snapshot_claim → fetch → write → bsr_snapshot_mark → fulfill jobs)
// and guarantees exactly-one in-flight fetch per date via the DB-side row lock.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  aggregate,
  DONE_BROKER_THRESHOLD,
  type Aggregated,
  type FinmindRow,
} from '../tw-bsr-finmind-sync/lib.ts';
import { computeBsrWindow, pickWindowDates } from './bsrRollup.ts';
import { groupByStock } from './finmindMarketBatch.ts';

export type SnapshotSource = 'finmind_market_batch' | 'finmind_per_stock' | 'manual';

export interface SnapshotClaim {
  claimed: boolean;
  prev_status: string;
  attempt_count: number;
}

/** Atomically transition snapshot to `fetching`. Returns false if another
 *  worker already owns it or if the date is already `ready` / `exhausted`. */
export async function claimSnapshot(
  supa: SupabaseClient,
  tradeDate: string,
  correlationId: string,
  leaseSeconds = 90,
): Promise<SnapshotClaim> {
  const { data, error } = await supa.rpc('bsr_snapshot_claim', {
    _trade_date: tradeDate,
    _correlation_id: correlationId,
    _lease_seconds: leaseSeconds,
  });
  if (error) {
    console.warn('[snapshot] claim failed:', error.message);
    return { claimed: false, prev_status: 'error', attempt_count: 0 };
  }
  const row = Array.isArray(data) ? data[0] : data;
  return {
    claimed: Boolean(row?.claimed),
    prev_status: String(row?.prev_status ?? 'pending'),
    attempt_count: Number(row?.attempt_count ?? 0),
  };
}

export async function markSnapshot(
  supa: SupabaseClient,
  tradeDate: string,
  status: 'ready' | 'partial' | 'exhausted' | 'failed' | 'pending',
  source: SnapshotSource | null,
  coverageStocks: number,
  coverageRows: number,
  lastError: string | null = null,
): Promise<void> {
  const { error } = await supa.rpc('bsr_snapshot_mark', {
    _trade_date: tradeDate,
    _status: status,
    _source: source,
    _coverage_stocks: coverageStocks,
    _coverage_rows: coverageRows,
    _last_error: lastError,
  });
  if (error) console.warn('[snapshot] mark failed:', error.message);
}

/** Bulk-mark queue rows for this date as done for stocks with sufficient BSR data. */
export async function fulfillJobsFromSnapshot(
  supa: SupabaseClient,
  tradeDate: string,
  threshold = DONE_BROKER_THRESHOLD,
): Promise<{ fulfilled: number; stillPending: number }> {
  const { data, error } = await supa.rpc('bsr_snapshot_fulfill_jobs', {
    _trade_date: tradeDate,
    _threshold: threshold,
  });
  if (error) {
    console.warn('[snapshot] fulfill jobs failed:', error.message);
    return { fulfilled: 0, stillPending: 0 };
  }
  const row = Array.isArray(data) ? data[0] : data;
  return {
    fulfilled: Number(row?.fulfilled ?? 0),
    stillPending: Number(row?.still_pending ?? 0),
  };
}

/**
 * Write aggregated rows into tw_bsr_daily and rebuild rollup for every
 * involved stock. Returns coverage counts. Idempotent (upsert on unique key).
 */
export async function persistAggregated(
  supa: SupabaseClient,
  tradeDate: string,
  agg: Aggregated[],
): Promise<{ stocks: number; rows: number }> {
  const CHUNK = 500;
  for (let i = 0; i < agg.length; i += CHUNK) {
    const { error } = await supa.from('tw_bsr_daily')
      .upsert(agg.slice(i, i + CHUNK), { onConflict: 'stock_id,trade_date,broker_id' });
    if (error) throw new Error(`upsert_failed:${error.message}`);
  }

  const byStock = groupByStock(agg);
  const stocks = Array.from(byStock.keys()).filter((sid) =>
    (byStock.get(sid)?.length ?? 0) >= DONE_BROKER_THRESHOLD
  );

  // Rebuild rollup (5/20/60) for every fulfilled stock. Uses last-90-day history.
  const since = new Date(new Date(tradeDate).getTime() - 90 * 86400_000)
    .toISOString().slice(0, 10);
  const upserts: any[] = [];
  for (const sid of stocks) {
    const { data: histRows } = await supa
      .from('tw_bsr_daily')
      .select('trade_date, broker_id, broker_name, net_shares, buy_shares, sell_shares')
      .eq('stock_id', sid).gte('trade_date', since).lte('trade_date', tradeDate)
      .order('trade_date', { ascending: false });
    const rows = histRows || [];
    const uniqueDates = Array.from(new Set(rows.map((r: any) => r.trade_date)))
      .sort((a, b) => (a < b ? 1 : -1));
    for (const win of [5, 20, 60] as const) {
      const dates = pickWindowDates(uniqueDates as string[], win);
      const w = computeBsrWindow(rows as any, dates);
      if (!w) continue;
      upserts.push({
        stock_id: sid, as_of_date: tradeDate, window_days: win,
        foreign_net: 0, trust_net: 0, dealer_net: 0,
        top_buy_brokers: w.top_buy, top_sell_brokers: w.top_sell,
        concentration_ratio: w.concentration_ratio, bsr_available: true,
        updated_at: new Date().toISOString(),
      });
    }
  }
  if (upserts.length > 0) {
    for (let i = 0; i < upserts.length; i += CHUNK) {
      await supa.from('tw_chips_rollup')
        .upsert(upserts.slice(i, i + CHUNK),
          { onConflict: 'stock_id,as_of_date,window_days' });
    }
  }
  return { stocks: stocks.length, rows: agg.length };
}

/**
 * Full happy-path fulfill:
 *   claim → aggregate raw rows → persist → rebuild rollup → mark snapshot →
 *   bulk-fulfill queue jobs.
 * Caller must have already fetched `rawRows` (typically via fetchFinmindMarketDay
 * or per-stock fetches). This lets tests exercise the orchestration with a
 * synthetic row set.
 */
export async function fulfillDay(
  supa: SupabaseClient,
  tradeDate: string,
  correlationId: string,
  rawRows: FinmindRow[],
  source: SnapshotSource,
): Promise<{
  claimed: boolean;
  prev_status: string;
  coverage_stocks: number;
  coverage_rows: number;
  jobs_fulfilled: number;
  jobs_still_pending: number;
  final_status: 'ready' | 'partial' | 'skipped_not_claimed';
}> {
  const claim = await claimSnapshot(supa, tradeDate, correlationId);
  if (!claim.claimed) {
    return {
      claimed: false, prev_status: claim.prev_status,
      coverage_stocks: 0, coverage_rows: 0,
      jobs_fulfilled: 0, jobs_still_pending: 0,
      final_status: 'skipped_not_claimed',
    };
  }
  try {
    const agg = aggregate(rawRows);
    const coverage = await persistAggregated(supa, tradeDate, agg);
    const finalStatus: 'ready' | 'partial' = coverage.stocks > 0 ? 'ready' : 'partial';
    await markSnapshot(supa, tradeDate, finalStatus, source, coverage.stocks, coverage.rows);
    const fulfill = await fulfillJobsFromSnapshot(supa, tradeDate);
    return {
      claimed: true, prev_status: claim.prev_status,
      coverage_stocks: coverage.stocks, coverage_rows: coverage.rows,
      jobs_fulfilled: fulfill.fulfilled, jobs_still_pending: fulfill.stillPending,
      final_status: finalStatus,
    };
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    await markSnapshot(supa, tradeDate, 'failed', source, 0, 0, msg.slice(0, 500));
    throw e;
  }
}
