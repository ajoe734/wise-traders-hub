import { useQuery } from '@tanstack/react-query';
import { useProjectionStatus } from '@/hooks/useProjectionStatus';
import { gateSeries } from '@/contracts/publicEconomicContract';
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
  /** 本 bucket（日/月結算點）實際計入的交易筆數 */
  sampleCount: number;
  /** 其中已平倉（exit_date ≤ D）的筆數 */
  closedCount: number;
  /** 其中尚未平倉、以標記價計算 PnL 的筆數 */
  openCount: number;
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
function isoDay(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
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
  const out: Date[] = [];
  const d = new Date(now);
  while (out.length < 20) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) out.unshift(new Date(d));
    d.setDate(d.getDate() - 1);
  }
  return out;
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

/** instrument → ticker symbol（"8299 群聯" → "8299"） */
function symbolOf(instrument: string): string {
  return (instrument || '').split(' ')[0] || instrument;
}

/** snapshotMap: symbol → (yyyy-mm-dd → close_price) */
type SnapshotMap = Map<string, Map<string, number>>;

/**
 * 取得 D 日（end of day）的標記價：
 * 1. 若 D 當日有日收盤快照 → 用 close_price
 * 2. 若 D 當日無快照，往前找最近一個交易日的收盤
 * 3. 若 D 是「今天」且都找不到 → 用 current_price
 * 4. 都沒有 → fallback 至 entry_price
 */
function markPrice(t: RawTrade, D: Date, todayKey: string, snapMap: SnapshotMap): number {
  const sym = symbolOf(t.instrument);
  const inner = snapMap.get(sym);
  if (inner) {
    // try D，再往前回退最多 10 天找最近交易日收盤
    const probe = new Date(D);
    for (let i = 0; i < 10; i++) {
      const k = isoDay(probe);
      const c = inner.get(k);
      if (c != null) return Number(c);
      probe.setDate(probe.getDate() - 1);
    }
  }
  if (fmtDay(D) === todayKey && t.current_price != null) {
    return Number(t.current_price);
  }
  return Number(t.entry_price || 0);
}

/** Equity (PnL $) snapshot at end of day D */
function snapshotPnL(trades: RawTrade[], D: Date, todayKey: string, snapMap: SnapshotMap): number {
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
      pnl += (Number(t.exit_price || 0) - entryPrice) * qty;
    } else {
      const mark = markPrice(t, D, todayKey, snapMap);
      pnl += (mark - entryPrice) * qty;
    }
  }
  return pnl;
}

/** Per-stock cumulative return % at end of day D */
function perStockSnapshot(
  trades: RawTrade[],
  D: Date,
  todayKey: string,
  snapMap: SnapshotMap,
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
      const mark = markPrice(t, D, todayKey, snapMap);
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
function perStockPnLAt(
  trades: RawTrade[],
  D: Date,
  todayKey: string,
  snapMap: SnapshotMap,
): Map<string, number> {
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
      const mark = markPrice(t, D, todayKey, snapMap);
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
  todayKey: string,
  snapMap: SnapshotMap,
): StockTrade[] {
  const startPrior = new Date(rangeStart);
  startPrior.setDate(startPrior.getDate() - 1);
  startPrior.setHours(23, 59, 59, 999);

  const pnlEnd = perStockPnLAt(trades, rangeEnd, todayKey, snapMap);
  const pnlPrior = perStockPnLAt(trades, startPrior, todayKey, snapMap);

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

export function usePeriodPerformance(
  expertId: string | undefined,
  period: ViewPeriod,
  startingCapital?: number,
) {
  // R1-P: public chart surface — a not-ready scope yields an empty series,
  // never a flat 0 line.
  const projection = useProjectionStatus(expertId);
  const query = useQuery({
    queryKey: ['period-performance-v3', expertId, period, startingCapital ?? 0],
    queryFn: async (): Promise<PeriodBucket[]> => {
      if (!expertId) return [];

      const { data: tradeRows, error: tradesErr } = await supabase
        .from('trade_records')
        .select('instrument, entry_date, exit_date, entry_price, exit_price, current_price, quantity, status, pnl_percent')
        .eq('expert_id', expertId);
      if (tradesErr) throw tradesErr;
      const trades = (tradeRows || []) as RawTrade[];

      const capital = Number(startingCapital || 0) || 1_000_000;
      const todayKey = fmtDay(new Date());

      const dates: Date[] =
        period === 'weekly' ? getWeeklyDays()
        : period === 'monthly' ? getMonthlyDays()
        : getYearlyMonthEnds();

      const labelOf = (d: Date) => (period === 'yearly' ? fmtMonth(d) : fmtDay(d));

      const rangeStart = dates[0] ? new Date(dates[0]) : new Date();
      const rangeEnd = dates[dates.length - 1] ? new Date(dates[dates.length - 1]) : new Date();

      // 批次抓 daily_price_snapshots，避免 N+1
      const symbols = Array.from(new Set(trades.map(t => symbolOf(t.instrument)).filter(Boolean)));
      const snapMap: SnapshotMap = new Map();
      if (symbols.length > 0) {
        const fromIso = isoDay(new Date(rangeStart.getTime() - 14 * 86400000)); // 多抓兩週緩衝供回退
        const toIso = isoDay(new Date());
        const { data: snaps } = await supabase
          .from('daily_price_snapshots')
          .select('symbol, trade_date, close_price')
          .in('symbol', symbols)
          .gte('trade_date', fromIso)
          .lte('trade_date', toIso);
        for (const row of snaps || []) {
          const sym = (row as any).symbol as string;
          const td = (row as any).trade_date as string; // 'YYYY-MM-DD'
          const close = Number((row as any).close_price);
          if (!Number.isFinite(close)) continue;
          let inner = snapMap.get(sym);
          if (!inner) { inner = new Map(); snapMap.set(sym, inner); }
          inner.set(td, close);
        }
      }

      const rangeStocks = perStockRangeReturn(trades, rangeStart, rangeEnd, todayKey, snapMap);

      let prevCum = 0;
      const buckets = dates.map((d) => {
        const pnl = snapshotPnL(trades, d, todayKey, snapMap);
        const cum = capital > 0 ? (pnl / capital) * 100 : 0;
        const periodReturn = cum - prevCum;
        prevCum = cum;

        // 樣本統計：以本 bucket 日期 D 為結算點
        const Dts = d.getTime();
        let closedCount = 0;
        let openCount = 0;
        for (const t of trades) {
          if (!t.entry_date) continue;
          const entryTs = new Date(t.entry_date).getTime();
          if (entryTs > Dts) continue;
          const qty = Number(t.quantity || 0);
          const entryPrice = Number(t.entry_price || 0);
          if (!qty || !entryPrice) continue;
          const exitTs = t.exit_date ? new Date(t.exit_date).getTime() : null;
          if (exitTs !== null && exitTs <= Dts) closedCount += 1;
          else openCount += 1;
        }

        const stocks = perStockSnapshot(trades, d, todayKey, snapMap);
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
          sampleCount: closedCount + openCount,
          closedCount,
          openCount,
        } as PeriodBucket;
      });

      if (buckets.length) buckets[buckets.length - 1].rangeStocks = rangeStocks;
      return buckets;
    },
    enabled: !!expertId,
    staleTime: 60_000,
  });

  return {
    ...query,
    projection,
    data: query.data ? gateSeries(query.data as PeriodBucket[], projection) : query.data,
  };
}
