// _shared/snapshotFulfillment.ts
// M3 v2 — L2 Snapshot-First orchestration.
//
// A `trade_date` is the atomic unit of BSR truth. This module owns the state
// machine (bsr_snapshot_claim → fetch → write → bsr_snapshot_mark → fulfill jobs)
// and guarantees exactly-one in-flight fetch per date via the DB-side row lock.

import type { SupabaseClient } from './supabaseClients.ts';
import {
  aggregate,
  DONE_BROKER_THRESHOLD,
  type Aggregated,
  type FinmindRow,
} from '../tw-bsr-finmind-sync/lib.ts';
import { groupByStock } from './finmindMarketBatch.ts';


export type SnapshotSource = 'finmind_market_batch' | 'finmind_per_stock' | 'manual';

/** tw_chip_fact.source labels (matches materializer priority order). */
export type LaneSource = 'broker_scraper' | 'finmind_batch' | 'finmind_per_stock';

export function snapshotSourceToLane(src: SnapshotSource): LaneSource {
  if (src === 'finmind_market_batch') return 'finmind_batch';
  return 'finmind_per_stock';
}

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
  sealedByLane: LaneSource | null = null,
): Promise<void> {
  const { error } = await supa.rpc('bsr_snapshot_mark', {
    _trade_date: tradeDate,
    _status: status,
    _source: source,
    _coverage_stocks: coverageStocks,
    _coverage_rows: coverageRows,
    _last_error: lastError,
    _sealed_by_lane: sealedByLane,
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
  laneSource: LaneSource = 'finmind_per_stock',
): Promise<{ stocks: number; rows: number; materialized: number; skipped_sealed: boolean }> {
  const CHUNK = 500;
  const nowIso = new Date().toISOString();
  // 1. Append (upsert on unique lane) into tw_chip_fact — the immutable
  //    per-lane fact log. Materializer will promote winners to tw_bsr_daily.
  const factRows = agg.map((r) => ({
    stock_id: r.stock_id,
    trade_date: r.trade_date,
    broker_id: r.broker_id,
    broker_name: r.broker_name,
    source: laneSource,
    buy_shares: r.buy_shares,
    sell_shares: r.sell_shares,
    // net_shares 是 GENERATED ALWAYS（buy-sell），不可寫入，否則整批 upsert 失敗

    avg_buy_price: r.avg_buy_price,
    avg_sell_price: r.avg_sell_price,
    ingested_at: nowIso,
  }));
  for (let i = 0; i < factRows.length; i += CHUNK) {
    const { error } = await supa.from('tw_chip_fact')
      .upsert(factRows.slice(i, i + CHUNK), {
        onConflict: 'stock_id,trade_date,broker_id,source',
      });
    if (error) throw new Error(`chip_fact_upsert_failed:${error.message}`);
  }

  // 2. Materialize to tw_bsr_daily (no-op if snapshot already sealed).
  //    只針對這批剛寫入的個股 materialize；先前每檔都重算整日全市場 fact，
  //    造成 statement timeout（materialize_failed），補資料整條卡死。
  const touchedStockIds = Array.from(new Set(agg.map((r) => r.stock_id)));
  const { data: mat, error: matErr } = await supa.rpc(
    'materialize_bsr_daily_from_fact',
    { _trade_date: tradeDate, _stock_ids: touchedStockIds },
  );

  if (matErr) throw new Error(`materialize_failed:${matErr.message}`);
  const matRow = Array.isArray(mat) ? mat[0] : mat;
  const materialized = Number(matRow?.materialized_rows ?? 0);
  const skippedSealed = Boolean(matRow?.skipped_sealed ?? false);

  const byStock = groupByStock(agg);
  const stocks = Array.from(byStock.keys()).filter((sid) =>
    (byStock.get(sid)?.length ?? 0) >= DONE_BROKER_THRESHOLD
  );

  // 3. Rebuild rollup (1/5/10/20/60) for every fulfilled stock.
  //    以前這裡在 TS 端讀 90 天 raw 再現算，但 PostgREST 預設 1000 列上限會把
  //    「熱門股一天 800 分點」直接截成 1.2 天 → 1/5/10/20/60 全部退化成同一天，
  //    使用者在抽屜看到 5 日與 10 日數字一模一樣。改為呼叫 SQL RPC
  //    rebuild_bsr_rollup(_as_of, _stock_ids, _max_stocks)，聚合在 DB 端完成，無列上限。
  const RPC_CHUNK = 200;
  for (let i = 0; i < stocks.length; i += RPC_CHUNK) {
    const { error } = await supa.rpc('rebuild_bsr_rollup', {
      _as_of: tradeDate,
      _stock_ids: stocks.slice(i, i + RPC_CHUNK),
      _max_stocks: RPC_CHUNK,
    });
    if (error) throw new Error(`chips_rollup_upsert_failed:${error.message}`);
  }

  return { stocks: stocks.length, rows: agg.length, materialized, skipped_sealed: skippedSealed };
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
    const coverage = await persistAggregated(supa, tradeDate, agg, snapshotSourceToLane(source));
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
