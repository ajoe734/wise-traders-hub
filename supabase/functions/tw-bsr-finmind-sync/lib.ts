// tw-bsr-finmind-sync/lib.ts
// 純邏輯（無 side effect），從 index.ts 抽出以便 unit test。
// 這些函式一律不能依賴 supa/env/Date.now() 以外的全域狀態。
//
// 日期／交易日 helpers 已遷至 _shared/tradingDate.ts，讓 tw-chips-detail 共用。
// 這裡 re-export 保相容（lib_test.ts 與 index.ts 皆從本檔匯入）。
export {
  taipeiNowFrom,
  toIsoDate,
  addDays,
  isWeekday,
  rollBackToWeekday,
  isAfterCloseAt,
  decideEffectiveDate,
} from '../_shared/tradingDate.ts';

// ============ FinMind rows 聚合 ============
export type FinmindRow = {
  date: string;
  securities_trader_id?: string;
  securities_trader_no?: string;
  securities_trader: string;
  price: number;
  buy: number;
  sell: number;
  stock_id: string;
};

export type Aggregated = {
  stock_id: string; trade_date: string; broker_id: string; broker_name: string;
  buy_shares: number; sell_shares: number; net_shares: number;
  avg_buy_price: number | null; avg_sell_price: number | null;
};

export function aggregate(rows: FinmindRow[]): Aggregated[] {
  const map = new Map<string, Aggregated & { buy_amt: number; sell_amt: number }>();
  for (const r of rows) {
    const brokerId = String(r.securities_trader_id || r.securities_trader_no || '').trim();
    if (!brokerId) continue;
    const key = `${r.stock_id}|${r.date}|${brokerId}`;
    const buy = Number(r.buy || 0), sell = Number(r.sell || 0), price = Number(r.price || 0);
    let cur = map.get(key);
    if (!cur) {
      cur = {
        stock_id: r.stock_id, trade_date: r.date, broker_id: brokerId,
        broker_name: r.securities_trader || brokerId,
        buy_shares: 0, sell_shares: 0, net_shares: 0,
        avg_buy_price: null, avg_sell_price: null, buy_amt: 0, sell_amt: 0,
      };
      map.set(key, cur);
    }
    cur.buy_shares += buy; cur.sell_shares += sell;
    cur.buy_amt += buy * price; cur.sell_amt += sell * price;
  }
  const out: Aggregated[] = [];
  for (const v of map.values()) {
    v.net_shares = v.buy_shares - v.sell_shares;
    v.avg_buy_price = v.buy_shares > 0 ? +(v.buy_amt / v.buy_shares).toFixed(4) : null;
    v.avg_sell_price = v.sell_shares > 0 ? +(v.sell_amt / v.sell_shares).toFixed(4) : null;
    const { buy_amt: _b, sell_amt: _s, ...rest } = v as any;
    out.push(rest);
  }
  return out;
}

// ============ 失敗退避決策 ============
/** 完整完成即視為 done，門檻對齊 index.ts 的 isDoneAlready */
export const DONE_BROKER_THRESHOLD = 5;

/**
 * 失敗後 next_run 與 status：對齊 index.ts 中 worker 失敗分支。
 * - attempts >= max_attempts → failed，不再排程
 * - 否則 pending，next_run_at = now + min(120, 2^attempts * 5) 分鐘
 */
export function decideFailureRetry(opts: {
  attempts: number;
  maxAttempts: number;
  nowMs: number;
}): { status: 'pending' | 'failed'; nextRunAt: string | null; backoffMinutes: number } {
  const backoffMinutes = Math.min(120, Math.pow(2, opts.attempts) * 5);
  const shouldFail = opts.attempts >= opts.maxAttempts;
  return {
    status: shouldFail ? 'failed' : 'pending',
    nextRunAt: shouldFail ? null : new Date(opts.nowMs + backoffMinutes * 60_000).toISOString(),
    backoffMinutes,
  };
}
