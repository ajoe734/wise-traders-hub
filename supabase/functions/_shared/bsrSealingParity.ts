// Phase K — BSR sealing 反向驗證 純邏輯。
//
// 目標：對已封存 (sealed) 的交易日，驗證 tw_bsr_daily 分點總和是否等於
// daily_price_snapshots.volume。攔截 FinMind 拉取不完整、broker 匯總錯誤、
// 或個別分點被覆蓋等資料完整性問題。
//
// 不變量：
//   sum(broker.buy_shares)  ≈ daily_volume
//   sum(broker.sell_shares) ≈ daily_volume
//   sum(broker.net_shares)  ≈ 0
//
// 容忍：max(1 張, 1% of volume) — 覆蓋湊整與極少數未上報分點。
//
// 只在 sealed 日執行；非 sealed 交由 Phase E 的 fallback watchdog 負責。

import { SHARES_PER_LOT } from './lotSize.ts';

export const TOLERANCE_SHARES = SHARES_PER_LOT; // 1 張
export const TOLERANCE_PCT = 0.01;             // 1%
export const NET_TOLERANCE_SHARES = SHARES_PER_LOT;
export const MIN_SAMPLE = 20;
export const WARN_MISMATCH_PCT = 5;
export const CRIT_MISMATCH_PCT = 15;

export type BrokerRow = {
  stock_id: string;
  trade_date: string;
  buy_shares: number;
  sell_shares: number;
  net_shares: number;
};

export type VolumeRow = {
  symbol: string;       // tw_bsr_daily.stock_id 對應 daily_price_snapshots.symbol
  trade_date: string;
  volume: number;       // 股
};

export type ParityIssue =
  | 'buy_mismatch'
  | 'sell_mismatch'
  | 'net_nonzero'
  | 'missing_volume';

export type StockDayAudit = {
  stock_id: string;
  trade_date: string;
  ok: boolean;
  issues: ParityIssue[];
  broker_sum_buy: number;
  broker_sum_sell: number;
  broker_sum_net: number;
  daily_volume: number | null;
  buy_delta: number | null;
  sell_delta: number | null;
  tolerance_shares: number;
};

export function toleranceFor(volume: number): number {
  return Math.max(TOLERANCE_SHARES, Math.floor(volume * TOLERANCE_PCT));
}

export function auditStockDay(
  brokers: BrokerRow[],
  volume: number | null,
): StockDayAudit {
  const stock_id = brokers[0]?.stock_id ?? '';
  const trade_date = brokers[0]?.trade_date ?? '';
  const buy = brokers.reduce((s, r) => s + (r.buy_shares || 0), 0);
  const sell = brokers.reduce((s, r) => s + (r.sell_shares || 0), 0);
  const net = brokers.reduce((s, r) => s + (r.net_shares || 0), 0);
  const issues: ParityIssue[] = [];
  let buyDelta: number | null = null;
  let sellDelta: number | null = null;
  let tol = TOLERANCE_SHARES;
  if (volume == null) {
    issues.push('missing_volume');
  } else {
    tol = toleranceFor(volume);
    buyDelta = buy - volume;
    sellDelta = sell - volume;
    if (Math.abs(buyDelta) > tol) issues.push('buy_mismatch');
    if (Math.abs(sellDelta) > tol) issues.push('sell_mismatch');
  }
  if (Math.abs(net) > NET_TOLERANCE_SHARES) issues.push('net_nonzero');
  return {
    stock_id,
    trade_date,
    ok: issues.length === 0,
    issues,
    broker_sum_buy: buy,
    broker_sum_sell: sell,
    broker_sum_net: net,
    daily_volume: volume,
    buy_delta: buyDelta,
    sell_delta: sellDelta,
    tolerance_shares: tol,
  };
}

export type ParitySummary = {
  sampleSize: number;
  mismatched: number;
  missingVolume: number;
  mismatchRate: number;
  worstDeltas: StockDayAudit[];
  issueCounts: Record<ParityIssue, number>;
};

export function groupByStockDay(rows: BrokerRow[]): Map<string, BrokerRow[]> {
  const m = new Map<string, BrokerRow[]>();
  for (const r of rows) {
    const k = `${r.stock_id}|${r.trade_date}`;
    const arr = m.get(k) ?? [];
    arr.push(r);
    m.set(k, arr);
  }
  return m;
}

export function auditParityBatch(
  brokers: BrokerRow[],
  volumes: VolumeRow[],
): ParitySummary {
  const volMap = new Map<string, number>();
  for (const v of volumes) volMap.set(`${v.symbol}|${v.trade_date}`, v.volume);
  const groups = groupByStockDay(brokers);
  const audits: StockDayAudit[] = [];
  for (const [key, rows] of groups) {
    const v = volMap.has(key) ? volMap.get(key)! : null;
    audits.push(auditStockDay(rows, v));
  }
  const issueCounts: Record<ParityIssue, number> = {
    buy_mismatch: 0,
    sell_mismatch: 0,
    net_nonzero: 0,
    missing_volume: 0,
  };
  for (const a of audits) for (const i of a.issues) issueCounts[i] += 1;
  const mismatched = audits.filter(
    (a) => !a.ok && !(a.issues.length === 1 && a.issues[0] === 'missing_volume'),
  );
  const missingVolume = audits.filter((a) => a.issues.includes('missing_volume')).length;
  const denom = audits.length - missingVolume;
  const rate = denom <= 0 ? 0 : (mismatched.length / denom) * 100;
  const worst = [...mismatched]
    .sort(
      (a, b) =>
        Math.abs(b.buy_delta ?? 0) + Math.abs(b.sell_delta ?? 0) -
        (Math.abs(a.buy_delta ?? 0) + Math.abs(a.sell_delta ?? 0)),
    )
    .slice(0, 5);
  return {
    sampleSize: audits.length,
    mismatched: mismatched.length,
    missingVolume,
    mismatchRate: Number(rate.toFixed(2)),
    worstDeltas: worst,
    issueCounts,
  };
}

export type ParityAlertDecision = {
  triggered: boolean;
  level: 'warning' | 'critical' | null;
  reason: 'sample_too_small' | 'ok' | 'mismatch_rate';
  summary: ParitySummary;
};

export function decideParityAlert(
  summary: ParitySummary,
  opts: { minSample?: number; warnPct?: number; critPct?: number } = {},
): ParityAlertDecision {
  const minSample = opts.minSample ?? MIN_SAMPLE;
  const warn = opts.warnPct ?? WARN_MISMATCH_PCT;
  const crit = opts.critPct ?? CRIT_MISMATCH_PCT;
  const effective = summary.sampleSize - summary.missingVolume;
  if (effective < minSample) {
    return { triggered: false, level: null, reason: 'sample_too_small', summary };
  }
  if (summary.mismatchRate >= crit) {
    return { triggered: true, level: 'critical', reason: 'mismatch_rate', summary };
  }
  if (summary.mismatchRate >= warn) {
    return { triggered: true, level: 'warning', reason: 'mismatch_rate', summary };
  }
  return { triggered: false, level: null, reason: 'ok', summary };
}
