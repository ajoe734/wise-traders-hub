// Phase J — 三大法人 5 日快取一致性審計 純邏輯。
//
// 目標：驗證 tw_institutional_daily 每列的 total_net 與三大法人分項總和一致，
// 藉此攔截 T86 bulk / TWSE BFI82U / TPEX bulk 匯入時的解析錯誤。
// 之所以只做「自我一致性」而不做跨 lane 對照，是因為 (stock_id, trade_date)
// 唯一鍵已保證同一天同一檔只留一列；不同 lane 是覆寫關係，無法在 DB 內同時
// 存在兩列比對。若未來要跨 lane 驗證，應存到 audit 分表再套此函式。

export const TOLERANCE_SHARES = 1;      // 允許 ±1 股（浮點/湊整誤差）
export const MIN_SAMPLE = 20;           // 樣本 < 20 直接 skip
export const WARN_MISMATCH_PCT = 5;     // 5% 觸發 warning
export const CRIT_MISMATCH_PCT = 15;    // 15% 觸發 critical

export type InstRow = {
  stock_id: string;
  trade_date: string;
  foreign_net: number;
  trust_net: number;
  dealer_net: number;
  total_net: number;
  source?: string | null;
};

export type RowIssue =
  | 'total_mismatch'
  | 'all_parts_zero_total_nonzero';

export type RowAudit = {
  stock_id: string;
  trade_date: string;
  ok: boolean;
  issues: RowIssue[];
  expected_total: number;
  actual_total: number;
  delta: number;
};

export function auditRow(row: InstRow, tolerance = TOLERANCE_SHARES): RowAudit {
  const expected = (row.foreign_net ?? 0) + (row.trust_net ?? 0) + (row.dealer_net ?? 0);
  const actual = row.total_net ?? 0;
  const delta = actual - expected;
  const issues: RowIssue[] = [];
  if (Math.abs(delta) > tolerance) issues.push('total_mismatch');
  if (
    (row.foreign_net ?? 0) === 0 &&
    (row.trust_net ?? 0) === 0 &&
    (row.dealer_net ?? 0) === 0 &&
    actual !== 0
  ) {
    if (!issues.includes('total_mismatch')) issues.push('all_parts_zero_total_nonzero');
  }
  return {
    stock_id: row.stock_id,
    trade_date: row.trade_date,
    ok: issues.length === 0,
    issues,
    expected_total: expected,
    actual_total: actual,
    delta,
  };
}

export type BatchSummary = {
  sampleSize: number;
  mismatched: number;
  mismatchRate: number;   // 0-100
  worstDeltas: RowAudit[];  // top 5 by |delta|
  bySource: Record<string, { total: number; mismatched: number }>;
};

export function auditBatch(rows: InstRow[], tolerance = TOLERANCE_SHARES): BatchSummary {
  const audits = rows.map((r) => ({ audit: auditRow(r, tolerance), source: r.source ?? 'unknown' }));
  const mismatched = audits.filter((a) => !a.audit.ok);
  const bySource: Record<string, { total: number; mismatched: number }> = {};
  for (const a of audits) {
    const s = a.source;
    if (!bySource[s]) bySource[s] = { total: 0, mismatched: 0 };
    bySource[s].total += 1;
    if (!a.audit.ok) bySource[s].mismatched += 1;
  }
  const worst = [...mismatched]
    .sort((a, b) => Math.abs(b.audit.delta) - Math.abs(a.audit.delta))
    .slice(0, 5)
    .map((x) => x.audit);
  const rate = rows.length === 0 ? 0 : (mismatched.length / rows.length) * 100;
  return {
    sampleSize: rows.length,
    mismatched: mismatched.length,
    mismatchRate: Number(rate.toFixed(2)),
    worstDeltas: worst,
    bySource,
  };
}

export type AlertDecision = {
  triggered: boolean;
  level: 'warning' | 'critical' | null;
  reason: 'sample_too_small' | 'ok' | 'mismatch_rate';
  summary: BatchSummary;
};

export function decideAlert(
  summary: BatchSummary,
  opts: { minSample?: number; warnPct?: number; critPct?: number } = {},
): AlertDecision {
  const minSample = opts.minSample ?? MIN_SAMPLE;
  const warn = opts.warnPct ?? WARN_MISMATCH_PCT;
  const crit = opts.critPct ?? CRIT_MISMATCH_PCT;
  if (summary.sampleSize < minSample) {
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
