import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface StockTrade {
  symbol: string;
  name: string;
  returnPct: number;
  entryDate: string;
  holdingDays: number;
  entryPrice: number;
  currentPrice: number;
  contributionNote: string;
}

export interface PeriodBucket {
  label: string;
  returnPct: number;
  topStock?: { symbol: string; name: string; returnPct: number };
  bottomStock?: { symbol: string; name: string; returnPct: number };
  stocks: StockTrade[];
  /** 區間級各股報酬（僅最後一個 bucket 會帶；提供 best/worst 使用） */
  rangeStocks?: StockTrade[];
}

type ViewPeriod = 'yearly' | 'monthly' | 'weekly';

function fmtDay(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}/${mm}/${dd}`;
}
function fmtMonth(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}/${mm}`;
}

function getTradingDaysFromTo(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  const d = new Date(start);
  d.setHours(0, 0, 0, 0);
  const endTs = new Date(end);
  endTs.setHours(0, 0, 0, 0);
  while (d.getTime() <= endTs.getTime()) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) out.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function getWeeklyDays(): Date[] {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const out: Date[] = [];
  const d = new Date(now);
  while (out.length < 5) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) out.unshift(new Date(d));
    d.setDate(d.getDate() - 1);
  }
  return out;
}

function getMonthlyDays(): Date[] {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return getTradingDaysFromTo(start, now);
}

/** End-of-month dates (capped at today) for last 12 months */
function getYearlyMonthEnds(): Date[] {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const out: Date[] = [];
  for (let i = 11; i >= 0; i--) {
    const ref = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthEnd = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
    out.push(monthEnd.getTime() > now.getTime() ? now : monthEnd);
  }
  return out;
}

interface RawTrade {
  instrument: string;
  entry_date: string | null;
  exit_date: string | null;
  entry_price: number | null;
  exit_price: number | null;
  current_price: number | null;
  quantity: number | null;
  status: string | null;
  pnl_percent: number | null;
}

/** Equity (PnL $) snapshot at end of day D, given all trades */
function snapshotPnL(trades: RawTrade[], D: Date, todayKey: string): number {
  const Dts = D.getTime();
  let pnl = 0;
  for (const t of trades) {
    if (!t.entry_date) continue;
    const entryTs = new Date(t.entry_date).getTime();
    if (entryTs > Dts) continue;
    const qty = Number(t.quantity || 0);
    const entryPrice = Number(t.entry_price || 0);
    if (!qty || !entryPrice) continue;

    const exitTs = t.exit_date ? new Date(t.exit_date).getTime() : null;
    if (exitTs !== null && exitTs <= Dts) {
      // realized
      const exitPrice = Number(t.exit_price || 0);
      pnl += (exitPrice - entryPrice) * qty;
    } else {
      // open at end of D — 沒有歷史日線資料，以最新 current_price 為近似
      const mark = Number(t.current_price ?? entryPrice);
      pnl += (mark - entryPrice) * qty;
    }
  }
  return pnl;
}

/** Per-stock cumulative return % at end of day D */
function perStockSnapshot(
  trades: RawTrade[],
  D: Date,
  todayKey: string
): StockTrade[] {
  const Dts = D.getTime();
  const map = new Map<string, { cost: number; pnl: number; sample: RawTrade }>();
  for (const t of trades) {
    if (!t.entry_date) continue;
    const entryTs = new Date(t.entry_date).getTime();
    if (entryTs > Dts) continue;
    const qty = Number(t.quantity || 0);
    const entryPrice = Number(t.entry_price || 0);
    if (!qty || !entryPrice) continue;

    const exitTs = t.exit_date ? new Date(t.exit_date).getTime() : null;
    let pnl = 0;
    if (exitTs !== null && exitTs <= Dts) {
      pnl = (Number(t.exit_price || 0) - entryPrice) * qty;
    } else {
      const isToday = fmtDay(D) === todayKey;
      const mark = isToday ? Number(t.current_price ?? entryPrice) : entryPrice;
      pnl = (mark - entryPrice) * qty;
    }
    const cur = map.get(t.instrument) || { cost: 0, pnl: 0, sample: t };
    cur.cost += entryPrice * qty;
    cur.pnl += pnl;
    map.set(t.instrument, cur);
  }
  const out: StockTrade[] = [];
  map.forEach((v, k) => {
    const ret = v.cost > 0 ? (v.pnl / v.cost) * 100 : 0;
    const t = v.sample;
    const entryDate = t.entry_date || '';
    const holdingDays = entryDate
      ? Math.max(1, Math.round((D.getTime() - new Date(entryDate).getTime()) / 86400000))
      : 1;
    out.push({
      symbol: k,
      name: k,
      returnPct: Math.round(ret * 100) / 100,
      entryDate,
      holdingDays,
      entryPrice: Number(t.entry_price || 0),
      currentPrice: Number(t.current_price ?? t.exit_price ?? t.entry_price ?? 0),
      contributionNote: `累積報酬 ${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%`,
    });
  });
  return out;
}

/** Per-stock PnL ($) at end of day D */
function perStockPnLAt(trades: RawTrade[], D: Date, todayKey: string): Map<string, number> {
  const Dts = D.getTime();
  const map = new Map<string, number>();
  for (const t of trades) {
    if (!t.entry_date) continue;
    const entryTs = new Date(t.entry_date).getTime();
    if (entryTs > Dts) continue;
    const qty = Number(t.quantity || 0);
    const entryPrice = Number(t.entry_price || 0);
    if (!qty || !entryPrice) continue;
    const exitTs = t.exit_date ? new Date(t.exit_date).getTime() : null;
    let pnl = 0;
    if (exitTs !== null && exitTs <= Dts) {
      pnl = (Number(t.exit_price || 0) - entryPrice) * qty;
    } else {
      const mark = Number(t.current_price ?? entryPrice);
      pnl = (mark - entryPrice) * qty;
    }
    map.set(t.instrument, (map.get(t.instrument) || 0) + pnl);
  }
  return map;
}

/** 計算 [rangeStart, rangeEnd] 區間內各檔的「區間報酬」 */
function perStockRangeReturn(
  trades: RawTrade[],
  rangeStart: Date,
  rangeEnd: Date,
  todayKey: string
): StockTrade[] {
  const startPrior = new Date(rangeStart);
  startPrior.setDate(startPrior.getDate() - 1);
  startPrior.setHours(23, 59, 59, 999);

  const pnlEnd = perStockPnLAt(trades, rangeEnd, todayKey);
  const pnlPrior = perStockPnLAt(trades, startPrior, todayKey);

  // costBase：區間內任一時點曾持有的成本（簡化為 Σ entry_price × qty，僅算 entry_date ≤ rangeEnd）
  const costMap = new Map<string, { cost: number; sample: RawTrade }>();
  for (const t of trades) {
    if (!t.entry_date) continue;
    const entryTs = new Date(t.entry_date).getTime();
    if (entryTs > rangeEnd.getTime()) continue;
    const qty = Number(t.quantity || 0);
    const entryPrice = Number(t.entry_price || 0);
    if (!qty || !entryPrice) continue;
    const cur = costMap.get(t.instrument) || { cost: 0, sample: t };
    cur.cost += entryPrice * qty;
    costMap.set(t.instrument, cur);
  }

  const out: StockTrade[] = [];
  costMap.forEach((v, instrument) => {
    if (v.cost <= 0) return;
    const pnlInRange = (pnlEnd.get(instrument) || 0) - (pnlPrior.get(instrument) || 0);
    const ret = (pnlInRange / v.cost) * 100;
    const t = v.sample;
    const entryDate = t.entry_date || '';
    const holdingDays = entryDate
      ? Math.max(1, Math.round((rangeEnd.getTime() - new Date(entryDate).getTime()) / 86400000))
      : 1;
    out.push({
      symbol: instrument,
      name: instrument,
      returnPct: Math.round(ret * 100) / 100,
      entryDate,
      holdingDays,
      entryPrice: Number(t.entry_price || 0),
      currentPrice: Number(t.current_price ?? t.exit_price ?? t.entry_price ?? 0),
      contributionNote: `區間報酬 ${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%`,
    });
  });
  return out;
}

export function usePeriodPerformance(expertId: string | undefined, period: ViewPeriod) {
  return useQuery({
    queryKey: ['period-performance-v2', expertId, period],
    queryFn: async (): Promise<PeriodBucket[]> => {
      if (!expertId) return [];

      const [tradesRes, expertRes] = await Promise.all([
        supabase
          .from('trade_records')
          .select('instrument, entry_date, exit_date, entry_price, exit_price, current_price, quantity, status, pnl_percent')
          .eq('expert_id', expertId),
        supabase
          .from('experts')
          .select('starting_capital')
          .eq('id', expertId)
          .maybeSingle(),
      ]);

      if (tradesRes.error) throw tradesRes.error;
      const trades = (tradesRes.data || []) as RawTrade[];
      const startingCapital = Number((expertRes.data as any)?.starting_capital || 0) || 1_000_000;

      const todayKey = fmtDay(new Date());

      const dates: Date[] =
        period === 'weekly' ? getWeeklyDays()
        : period === 'monthly' ? getMonthlyDays()
        : getYearlyMonthEnds();

      const labelOf = (d: Date) => (period === 'yearly' ? fmtMonth(d) : fmtDay(d));

      // rangeStart：該 period 區間的起始日（與 dates[0] 對應）
      const rangeStart = dates[0] ? new Date(dates[0]) : new Date();
      const rangeEnd = dates[dates.length - 1] ? new Date(dates[dates.length - 1]) : new Date();
      const rangeStocks = perStockRangeReturn(trades, rangeStart, rangeEnd, todayKey);

      let prevCum = 0;
      const buckets = dates.map((d) => {
        const pnl = snapshotPnL(trades, d, todayKey);
        const cum = startingCapital > 0 ? (pnl / startingCapital) * 100 : 0;
        const periodReturn = cum - prevCum;
        prevCum = cum;

        const stocks = perStockSnapshot(trades, d, todayKey);
        const sorted = [...stocks].sort((a, b) => b.returnPct - a.returnPct);
        const topStock = sorted[0]
          ? { symbol: sorted[0].symbol, name: sorted[0].name, returnPct: sorted[0].returnPct }
          : undefined;
        const bottomStock = sorted.length
          ? {
              symbol: sorted[sorted.length - 1].symbol,
              name: sorted[sorted.length - 1].name,
              returnPct: sorted[sorted.length - 1].returnPct,
            }
          : undefined;

        return {
          label: labelOf(d),
          returnPct: Math.round(periodReturn * 100) / 100,
          topStock,
          bottomStock,
          stocks,
        } as PeriodBucket;
      });

      // 把區間級 rangeStocks 掛在最後一個 bucket（PerformanceOverviewPanel 會讀）
      if (buckets.length) buckets[buckets.length - 1].rangeStocks = rangeStocks;
      return buckets;
    },
    enabled: !!expertId,
    staleTime: 60_000,
  });
}
