/**
 * 績效 Factsheet 的唯一計算來源（pure functions，可單元測試）。
 *
 * 口徑憲法（與 `calculate_expert_performance` RPC 對齊，禁止另立算法）：
 *   pnl_amount        = quantity × (exit_price − entry_price)   ← quantity 為 base 單位（台股＝股）
 *   realized          = Σ pnl_amount（closed / stopped）
 *   unrealized        = Σ quantity × (current_price − entry_price)（open）
 *   total_return_pct  = (realized + unrealized) / starting_capital × 100（簡單報酬率，未年化）
 *   max_drawdown_pct  = max(peak − running) / starting_capital × 100，running 依 exit_date 排序累加
 *   win_rate          = pnl_percent > 0 的 closed 筆數 / closed 筆數
 *   profit_factor     = Σ 正 pnl_amount / |Σ 負 pnl_amount|
 *
 * 缺資料一律回傳 null（由呈現層標「資料尚不足」），禁止以 0 冒充。
 */

import {
  calcWinRate,
  calcProfitFactor,
  calcMaxDrawdown,
  calcTotalReturnPct,
  calcAvgPnlPct,
  calcAvgHoldDays,
} from '@/lib/performanceCalc';

export interface FactsheetTrade {
  id: string;
  instrument: string;
  entry_price: number | null;
  exit_price: number | null;
  current_price: number | null;
  quantity: number | null;
  entry_date: string | null;
  exit_date: string | null;
  pnl_percent: number | null;
  status: string;
}

export interface FactsheetExpert {
  id: string;
  slug: string;
  name: string;
  role: string;
  starting_capital: number | null;
  currency: string;
  asset_class: string;
  strategy_summary: string | null;
  description: string | null;
  style_tags: string[] | null;
  markets: string[] | null;
}

export type FactsheetRange = 'inception' | 'y1' | 'm6' | 'm3';

export const RANGE_LABEL: Record<FactsheetRange, string> = {
  inception: '成立以來',
  y1: '近一年',
  m6: '近六個月',
  m3: '近三個月',
};

/** 單筆已實現損益金額（元）。缺價一律視為 0 貢獻，並在 coverage 中揭露。 */
export function tradePnlAmount(t: FactsheetTrade): number {
  const q = t.quantity ?? 0;
  const entry = t.entry_price ?? 0;
  const exit = t.exit_price ?? entry;
  return q * (exit - entry);
}

/** 單筆未實現損益金額（元）。 */
export function openPnlAmount(t: FactsheetTrade): number {
  const q = t.quantity ?? 0;
  const entry = t.entry_price ?? 0;
  const cur = t.current_price ?? entry;
  return q * (cur - entry);
}

export interface EquityPoint {
  /** ISO date（exit_date 的日期部分） */
  date: string;
  /** 當日累計已實現淨值 = starting_capital + Σ realized */
  equity: number;
  /** 當日累計已實現損益 */
  cumRealized: number;
}

export interface MonthlyPoint {
  /** YYYY/MM */
  month: string;
  amount: number;
  /** 相對「月初已實現淨值」的報酬率 % */
  pct: number;
}

export interface Contributor {
  instrument: string;
  amount: number;
  pct: number | null;
  trades: number;
}

export interface LedgerRow {
  instrument: string;
  entryDate: string | null;
  exitDate: string | null;
  holdDays: number | null;
  amount: number;
  pct: number | null;
}

export interface FactsheetMetrics {
  startingCapital: number | null;
  realizedAmount: number;
  unrealizedAmount: number | null;
  currentAsset: number | null;
  totalReturnPct: number | null;
  maxDrawdownPct: number | null;
  closedTrades: number;
  openTrades: number;
  winRate: number | null;
  profitFactor: number | null;
  avgPnlPct: number | null;
  avgWinPct: number | null;
  avgLossPct: number | null;
  payoffRatio: number | null;
  avgHoldDays: number | null;
  positiveMonths: number;
  totalMonths: number;
  bestMonth: MonthlyPoint | null;
  worstMonth: MonthlyPoint | null;
}

export interface Factsheet {
  expert: FactsheetExpert;
  range: FactsheetRange;
  rangeLabel: string;
  periodStart: string | null;
  periodEnd: string | null;
  asOf: string;
  metrics: FactsheetMetrics;
  equity: EquityPoint[];
  drawdown: { date: string; ddPct: number }[];
  monthly: MonthlyPoint[];
  contributors: Contributor[];
  detractors: Contributor[];
  ledger: LedgerRow[];
  /** 本報告未涵蓋 / 資料庫無來源的欄位，必須在 PDF 揭露 */
  missing: string[];
}

const isoDay = (v: string | null): string | null => (v ? v.slice(0, 10) : null);

function rangeStartDate(range: FactsheetRange, asOf: Date): Date | null {
  const d = new Date(asOf);
  if (range === 'y1') { d.setFullYear(d.getFullYear() - 1); return d; }
  if (range === 'm6') { d.setMonth(d.getMonth() - 6); return d; }
  if (range === 'm3') { d.setMonth(d.getMonth() - 3); return d; }
  return null;
}

/**
 * 建立 factsheet。所有輸入都必須是資料庫真實資料；本函式不製造任何預設值。
 */
export function buildFactsheet(args: {
  expert: FactsheetExpert;
  trades: FactsheetTrade[];
  range: FactsheetRange;
  asOf?: Date;
}): Factsheet {
  const { expert, trades, range } = args;
  const asOf = args.asOf ?? new Date();
  const startingCapital = expert.starting_capital && expert.starting_capital > 0
    ? expert.starting_capital
    : null;

  const closedAll = trades
    .filter((t) => t.status === 'closed' || t.status === 'stopped')
    .filter((t) => !!t.exit_date)
    .sort((a, b) => (a.exit_date! < b.exit_date! ? -1 : 1));
  const open = trades.filter((t) => t.status === 'open');

  const from = rangeStartDate(range, asOf);
  const closed = from
    ? closedAll.filter((t) => new Date(t.exit_date!) >= from)
    : closedAll;

  // ── 已實現淨值序列（基準永遠是 starting_capital，與 RPC 的 MDD 分母一致）──
  const equity: EquityPoint[] = [];
  let cum = 0;
  for (const t of closed) {
    cum += tradePnlAmount(t);
    const date = isoDay(t.exit_date)!;
    const last = equity[equity.length - 1];
    const point = { date, cumRealized: cum, equity: (startingCapital ?? 0) + cum };
    if (last && last.date === date) equity[equity.length - 1] = point;
    else equity.push(point);
  }

  const realizedAmount = cum;
  const unrealizedAmount = open.length > 0
    ? open.reduce((s, t) => s + openPnlAmount(t), 0)
    : (open.length === 0 ? 0 : null);

  const maxDrawdownPct = startingCapital
    ? calcMaxDrawdown(closed.map((t) => ({ pnl_amount: tradePnlAmount(t) })), startingCapital)
    : null;

  const totalReturnPct = startingCapital
    ? calcTotalReturnPct(realizedAmount, unrealizedAmount ?? 0, startingCapital)
    : null;

  const winRate = closed.length > 0
    ? calcWinRate(closed.length, closed.filter((t) => (t.pnl_percent ?? 0) > 0).length)
    : null;

  const gp = closed.reduce((s, t) => s + Math.max(tradePnlAmount(t), 0), 0);
  const gl = closed.reduce((s, t) => s + Math.max(-tradePnlAmount(t), 0), 0);
  const profitFactor = closed.length > 0 ? calcProfitFactor(gp, gl) : null;

  const pcts = closed.map((t) => t.pnl_percent).filter((v): v is number => v != null);
  const avgPnlPct = pcts.length > 0 ? calcAvgPnlPct(pcts) : null;
  const winPcts = pcts.filter((v) => v > 0);
  const lossPcts = pcts.filter((v) => v < 0);
  const avgWinPct = winPcts.length > 0 ? calcAvgPnlPct(winPcts) : null;
  const avgLossPct = lossPcts.length > 0 ? calcAvgPnlPct(lossPcts) : null;
  const payoffRatio = avgWinPct != null && avgLossPct != null && avgLossPct !== 0
    ? Math.round((avgWinPct / Math.abs(avgLossPct)) * 100) / 100
    : null;

  const holdable = [...closed, ...open]
    .filter((t) => t.entry_date)
    .map((t) => ({
      entry_date: new Date(t.entry_date!),
      exit_date: t.exit_date ? new Date(t.exit_date) : null,
    }));
  const avgHoldDays = holdable.length > 0 ? calcAvgHoldDays(holdable, asOf) : null;

  // ── 月度（相對月初已實現淨值） ──
  const byMonth = new Map<string, number>();
  for (const t of closed) {
    const d = isoDay(t.exit_date)!;
    const key = `${d.slice(0, 4)}/${d.slice(5, 7)}`;
    byMonth.set(key, (byMonth.get(key) ?? 0) + tradePnlAmount(t));
  }
  const monthly: MonthlyPoint[] = [];
  let base = startingCapital ?? 0;
  for (const [month, amount] of [...byMonth.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const pct = base > 0 ? Math.round((amount / base) * 10000) / 100 : 0;
    monthly.push({ month, amount, pct });
    base += amount;
  }
  const sortedMonths = [...monthly].sort((a, b) => a.amount - b.amount);

  // ── drawdown 曲線（% of starting capital） ──
  let peak = 0;
  const drawdown = equity.map((p) => {
    if (p.cumRealized > peak) peak = p.cumRealized;
    const ddPct = startingCapital
      ? -Math.round(((peak - p.cumRealized) / startingCapital) * 10000) / 100
      : 0;
    return { date: p.date, ddPct };
  });

  // ── 個股歸因 ──
  const bySymbol = new Map<string, { amount: number; trades: number; pcts: number[] }>();
  for (const t of closed) {
    const cur = bySymbol.get(t.instrument) ?? { amount: 0, trades: 0, pcts: [] };
    cur.amount += tradePnlAmount(t);
    cur.trades += 1;
    if (t.pnl_percent != null) cur.pcts.push(t.pnl_percent);
    bySymbol.set(t.instrument, cur);
  }
  const agg: Contributor[] = [...bySymbol.entries()].map(([instrument, v]) => ({
    instrument,
    amount: v.amount,
    pct: v.pcts.length > 0 ? calcAvgPnlPct(v.pcts) : null,
    trades: v.trades,
  }));
  const contributors = agg.filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount).slice(0, 5);
  const detractors = agg.filter((c) => c.amount < 0).sort((a, b) => a.amount - b.amount).slice(0, 5);

  const ledger: LedgerRow[] = [...closed]
    .sort((a, b) => (a.exit_date! > b.exit_date! ? -1 : 1))
    .slice(0, 12)
    .map((t) => ({
      instrument: t.instrument,
      entryDate: isoDay(t.entry_date),
      exitDate: isoDay(t.exit_date),
      holdDays: t.entry_date && t.exit_date
        ? Math.max(0, Math.round(
            (new Date(t.exit_date).getTime() - new Date(t.entry_date).getTime()) / 86400000,
          ))
        : null,
      amount: tradePnlAmount(t),
      pct: t.pnl_percent,
    }));

  const missing: string[] = [
    '交易成本：手續費、證交稅與滑價未計入，實際淨報酬將低於本表數字。',
    '基準指數：資料庫目前無涵蓋本期間的完整大盤／0050 日線序列，故不列相對績效。',
    '淨值序列：以「已實現損益」逐筆累計，未含未實現部位的逐日評價，故非逐日市值曲線。',
    '外部金流：無入出金紀錄，報酬率為簡單報酬率（未做時間加權、未年化）。',
  ];
  if (startingCapital == null) missing.unshift('初始資金未設定，報酬率與最大回撤無法計算。');

  return {
    expert,
    range,
    rangeLabel: RANGE_LABEL[range],
    periodStart: closed.length > 0 ? isoDay(closed[0].entry_date ?? closed[0].exit_date) : null,
    periodEnd: closed.length > 0 ? isoDay(closed[closed.length - 1].exit_date) : null,
    asOf: asOf.toISOString().slice(0, 10),
    metrics: {
      startingCapital,
      realizedAmount,
      unrealizedAmount,
      currentAsset: startingCapital != null
        ? startingCapital + realizedAmount + (unrealizedAmount ?? 0)
        : null,
      totalReturnPct,
      maxDrawdownPct,
      closedTrades: closed.length,
      openTrades: open.length,
      winRate,
      profitFactor,
      avgPnlPct,
      avgWinPct,
      avgLossPct,
      payoffRatio,
      avgHoldDays,
      positiveMonths: monthly.filter((m) => m.amount > 0).length,
      totalMonths: monthly.length,
      bestMonth: sortedMonths.length > 0 ? sortedMonths[sortedMonths.length - 1] : null,
      worstMonth: sortedMonths.length > 0 ? sortedMonths[0] : null,
    },
    equity,
    drawdown,
    monthly,
    contributors,
    detractors,
    ledger,
    missing,
  };
}

/** 呈現層 helper：null → 「資料尚不足」，禁止顯示 0 冒充。 */
export const fmtOrNA = (
  v: number | null | undefined,
  fmt: (n: number) => string,
): string => (v == null ? '資料尚不足' : fmt(v));
