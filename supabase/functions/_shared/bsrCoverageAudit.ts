// Phase L1 — BSR 分點覆蓋率審計純邏輯。
//
// 輸入：已封盤日的 (stock_id, trade_date, broker_sum_shares, broker_count, snapshot_volume_lots) 三元組。
// 目標：把「分點總和 ≠ 成交量」拆成三種可診斷的失效類別：
//   1. missing_snapshot — daily_price_snapshots 沒有該日 volume。
//   2. stale_snapshot   — 同一 stock 連續 ≥3 個交易日 snapshot_volume 完全相同（明顯未更新）。
//   3. broker_under_cover — coverage_pct = broker_shares / (snapshot_volume_lots * 1000) * 100 < UNDER_COVER_PCT。
//   4. broker_over_cover  — coverage_pct > OVER_COVER_PCT（分點端重複或跨市場疊加）。
// 分開量化後，Phase K 的 sealing parity 才能剔除資料源缺陷的雜訊。

export const UNDER_COVER_PCT = 60;
export const OVER_COVER_PCT = 120;
export const STALE_STREAK_MIN = 3;
export const MIN_SAMPLE = 20;
export const WARN_UNDER_RATE_PCT = 20;
export const CRIT_UNDER_RATE_PCT = 50;
export const WARN_MISSING_RATE_PCT = 30;
export const CRIT_MISSING_RATE_PCT = 70;

export type CoverageInput = {
  stock_id: string;
  trade_date: string;
  broker_sum_shares: number;
  broker_count: number;
  // Phase L2: 已由 DB 統一成「股」(daily_price_snapshots.volume_shares)。
  snapshot_volume_shares: number | null;
};

export type CoverageClass =
  | 'ok'
  | 'missing_snapshot'
  | 'stale_snapshot'
  | 'broker_under_cover'
  | 'broker_over_cover';

export type CoverageRow = CoverageInput & {
  coverage_pct: number | null;
  class: CoverageClass;
};

export type CoverageSummary = {
  sampleSize: number;
  ok: number;
  missingSnapshot: number;
  staleSnapshot: number;
  underCover: number;
  overCover: number;
  missingRate: number;
  underRate: number;
  overRate: number;
  worst: CoverageRow[];
};

export type AlertDecision = {
  triggered: boolean;
  level: 'warning' | 'critical' | null;
  reason: string;
  kind: 'bsr_broker_coverage_low' | 'daily_snapshot_volume_missing' | null;
};

/** 掃描每檔 stock 連續 N 天 snapshot_volume 相同的日期集合。 */
export function detectStaleSnapshots(
  inputs: CoverageInput[],
  minStreak: number = STALE_STREAK_MIN,
): Set<string> {
  const byStock = new Map<string, CoverageInput[]>();
  for (const r of inputs) {
    if (r.snapshot_volume_shares == null) continue;
    const arr = byStock.get(r.stock_id) ?? [];
    arr.push(r);
    byStock.set(r.stock_id, arr);
  }
  const stale = new Set<string>();
  for (const [, rows] of byStock) {
    const sorted = [...rows].sort((a, b) => (a.trade_date < b.trade_date ? -1 : 1));
    let streak = 1;
    let prev = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
      const cur = sorted[i];
      if (cur.snapshot_volume_shares === prev.snapshot_volume_shares) {
        streak++;
      } else {
        streak = 1;
      }
      if (streak >= minStreak) {
        for (let j = i - streak + 1; j <= i; j++) {
          stale.add(`${sorted[j].stock_id}|${sorted[j].trade_date}`);
        }
      }
      prev = cur;
    }
  }
  return stale;
}

export function classifyCoverage(
  input: CoverageInput,
  staleKeys: Set<string>,
): CoverageRow {
  const key = `${input.stock_id}|${input.trade_date}`;
  if (input.snapshot_volume_shares == null) {
    return { ...input, coverage_pct: null, class: 'missing_snapshot' };
  }
  if (staleKeys.has(key)) {
    return { ...input, coverage_pct: null, class: 'stale_snapshot' };
  }
  const denom = input.snapshot_volume_shares;
  const pct = denom > 0 ? +((input.broker_sum_shares / denom) * 100).toFixed(1) : 0;
  let cls: CoverageClass = 'ok';
  if (pct < UNDER_COVER_PCT) cls = 'broker_under_cover';
  else if (pct > OVER_COVER_PCT) cls = 'broker_over_cover';
  return { ...input, coverage_pct: pct, class: cls };
}

export function auditCoverage(inputs: CoverageInput[]): CoverageSummary {
  const stale = detectStaleSnapshots(inputs);
  const rows = inputs.map((i) => classifyCoverage(i, stale));
  const n = rows.length;
  const missing = rows.filter((r) => r.class === 'missing_snapshot').length;
  const staleN = rows.filter((r) => r.class === 'stale_snapshot').length;
  const under = rows.filter((r) => r.class === 'broker_under_cover').length;
  const over = rows.filter((r) => r.class === 'broker_over_cover').length;
  const ok = n - missing - staleN - under - over;
  const worst = rows
    .filter((r) => r.class === 'broker_under_cover')
    .sort((a, b) => (a.coverage_pct ?? 100) - (b.coverage_pct ?? 100))
    .slice(0, 10);
  return {
    sampleSize: n,
    ok,
    missingSnapshot: missing,
    staleSnapshot: staleN,
    underCover: under,
    overCover: over,
    missingRate: n > 0 ? +((missing / n) * 100).toFixed(1) : 0,
    underRate: n > 0 ? +((under / n) * 100).toFixed(1) : 0,
    overRate: n > 0 ? +((over / n) * 100).toFixed(1) : 0,
    worst,
  };
}

export function decideCoverageAlerts(summary: CoverageSummary): AlertDecision[] {
  const out: AlertDecision[] = [];
  if (summary.sampleSize < MIN_SAMPLE) {
    return [{ triggered: false, level: null, reason: 'sample_too_small', kind: null }];
  }
  // Missing snapshot alert
  if (summary.missingRate >= CRIT_MISSING_RATE_PCT) {
    out.push({ triggered: true, level: 'critical', reason: 'missing_rate_critical', kind: 'daily_snapshot_volume_missing' });
  } else if (summary.missingRate >= WARN_MISSING_RATE_PCT) {
    out.push({ triggered: true, level: 'warning', reason: 'missing_rate_warning', kind: 'daily_snapshot_volume_missing' });
  }
  // Broker under-cover alert
  if (summary.underRate >= CRIT_UNDER_RATE_PCT) {
    out.push({ triggered: true, level: 'critical', reason: 'under_cover_critical', kind: 'bsr_broker_coverage_low' });
  } else if (summary.underRate >= WARN_UNDER_RATE_PCT) {
    out.push({ triggered: true, level: 'warning', reason: 'under_cover_warning', kind: 'bsr_broker_coverage_low' });
  }
  return out.length ? out : [{ triggered: false, level: null, reason: 'within_thresholds', kind: null }];
}
