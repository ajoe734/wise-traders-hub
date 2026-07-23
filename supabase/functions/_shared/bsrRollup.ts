// _shared/bsrRollup.ts
// BSR window 聚合 + raw 完整性判定。
// tw-bsr-finmind-sync 的 rebuildRollup 與 tw-chips-detail 的 raw fallback 皆呼叫同一套演算法，
// 確保 rollup 與 fallback 對相同輸入永遠給出相同 top_buy / top_sell / concentration。

export type BsrDailyRow = {
  trade_date: string;
  broker_id: string;
  broker_name?: string | null;
  buy_shares?: number | null;
  sell_shares?: number | null;
  net_shares?: number | null;
};

export type BrokerEntry = { broker_id: string; name: string; net: number };
export type BsrWindow = {
  top_buy: BrokerEntry[];
  top_sell: BrokerEntry[];
  concentration_ratio: number | null;
  days_covered: number;
};

/** 缺名時的統一 fallback。 */
export function nameOrFallback(brokerId: string, name?: string | null): string {
  const trimmed = (name ?? '').trim();
  return trimmed || `券商分點 ${brokerId}`;
}

/**
 * 依指定 trade_date 集合聚合 BSR。演算法 100% 對齊原 tw-bsr-finmind-sync/index.ts::rebuildRollup：
 *   - 依 broker_id 累加 net / buy / sell
 *   - top_buy：net desc top 3
 *   - top_sell：net asc top 3
 *   - concentration：sort by buy desc top 15 → sum(buy) / sum(all buy) * 100
 *   - days_covered：不同 trade_date 數
 */
export function computeBsrWindow(
  rows: BsrDailyRow[],
  dates: string[] | Set<string>,
): BsrWindow | null {
  const dateSet = dates instanceof Set ? dates : new Set(dates);
  const slice = rows.filter((r) => dateSet.has(r.trade_date));
  if (slice.length === 0) return null;
  const agg = new Map<string, { name: string; net: number; buy: number; sell: number }>();
  const daysUsed = new Set<string>();
  for (const r of slice) {
    daysUsed.add(r.trade_date);
    const cur = agg.get(r.broker_id) || {
      name: nameOrFallback(r.broker_id, r.broker_name),
      net: 0,
      buy: 0,
      sell: 0,
    };
    if (!cur.name || cur.name === r.broker_id) {
      cur.name = nameOrFallback(r.broker_id, r.broker_name);
    }
    cur.net += Number(r.net_shares || 0);
    cur.buy += Number(r.buy_shares || 0);
    cur.sell += Number(r.sell_shares || 0);
    agg.set(r.broker_id, cur);
  }
  const list = Array.from(agg.entries()).map(([broker_id, v]) => ({ broker_id, ...v }));
  const top_buy = [...list].sort((a, b) => b.net - a.net).slice(0, 3)
    .map((b) => ({ broker_id: b.broker_id, name: b.name, net: b.net }));
  const top_sell = [...list].sort((a, b) => a.net - b.net).slice(0, 3)
    .map((b) => ({ broker_id: b.broker_id, name: b.name, net: b.net }));
  const totalBuy = list.reduce((s, b) => s + b.buy, 0);
  const top15Buy = [...list].sort((a, b) => b.buy - a.buy).slice(0, 15)
    .reduce((s, b) => s + b.buy, 0);
  const concentration_ratio = totalBuy > 0 ? (top15Buy / totalBuy) * 100 : null;
  return { top_buy, top_sell, concentration_ratio, days_covered: daysUsed.size };
}

/** 從已排序（desc）的 unique trade_date 陣列取前 N 個作為視窗。 */
export function pickWindowDates(uniqueDatesDesc: string[], windowSize: number): string[] {
  return uniqueDatesDesc.slice(0, windowSize);
}

/**
 * 從候選 trade_date（{date, rowCount}）中挑「最新且已 complete」的日期。
 * complete = (queue.status='done' for that (stock, date)) OR rowCount >= DONE_BROKER_THRESHOLD
 *
 * 這是本次修訂的核心：只要今日 raw 尚未 complete，就不該把 fallbackAsOf 推到今日，
 * 避免用不完整的今日 partial data 覆蓋昨日完整的 rollup。
 */
export const DONE_BROKER_THRESHOLD = 5;

export function pickCompleteFallbackDate(
  candidates: Array<{ date: string; rowCount: number }>,
  doneDateSet: Set<string>,
): string | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  for (const c of sorted) {
    if (doneDateSet.has(c.date) || c.rowCount >= DONE_BROKER_THRESHOLD) return c.date;
  }
  return null;
}

/** 便於 detail 收集 (date -> rowCount) 的 helper。 */
export function countRowsByDate(rows: BsrDailyRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.trade_date, (m.get(r.trade_date) ?? 0) + 1);
  return m;
}
