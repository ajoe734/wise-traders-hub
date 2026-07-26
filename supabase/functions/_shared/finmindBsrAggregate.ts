// _shared/finmindBsrAggregate.ts
// FinMind TaiwanStockTradingDailyReport rows → per-stock/per-date/per-broker aggregates.
// Shared by tw-bsr-finmind-sync and backfill-worker.

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
  stock_id: string;
  trade_date: string;
  broker_id: string;
  broker_name: string;
  buy_shares: number;
  sell_shares: number;
  net_shares: number;
  avg_buy_price: number | null;
  avg_sell_price: number | null;
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
        stock_id: r.stock_id,
        trade_date: r.date,
        broker_id: brokerId,
        broker_name: r.securities_trader || brokerId,
        buy_shares: 0,
        sell_shares: 0,
        net_shares: 0,
        avg_buy_price: null,
        avg_sell_price: null,
        buy_amt: 0,
        sell_amt: 0,
      };
      map.set(key, cur);
    }
    cur.buy_shares += buy;
    cur.sell_shares += sell;
    cur.buy_amt += buy * price;
    cur.sell_amt += sell * price;
  }
  const out: Aggregated[] = [];
  for (const v of map.values()) {
    v.net_shares = v.buy_shares - v.sell_shares;
    v.avg_buy_price = v.buy_shares > 0 ? +(v.buy_amt / v.buy_shares).toFixed(4) : null;
    v.avg_sell_price = v.sell_shares > 0 ? +(v.sell_amt / v.sell_shares).toFixed(4) : null;
    const { buy_amt: _b, sell_amt: _s, ...rest } = v as Aggregated & { buy_amt: number; sell_amt: number };
    out.push(rest);
  }
  return out;
}
