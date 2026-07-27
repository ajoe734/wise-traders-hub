// Pure logic for the "chips fallback persistence" alert (Phase E).
//
// Rules the alerts-watchdog applies per wave:
//   Consecutive-3 rule — take the latest 3 orchestrator runs of a given wave.
//   Trigger when EITHER of these holds for all three runs:
//     - sealed = false
//     - fallback_rate > 30%   (fallback_used_count / max(coverage_stocks,1))
//
// Runs with coverage_stocks = 0 count as sealed=false / fallback_rate=1.
// Runs with `status = 'skipped_dry_run'` or `status = 'error'` are treated
// as failed (sealed=false, fallback_rate=1).
//
// Output is one decision per wave; the caller writes at most one alert per
// wave per dedup window.

export type KeepwarmMetric = {
  wave: number;
  trade_date: string;
  status: string | null;
  sealed: boolean | null;
  sealed_by_lane: string | null;
  coverage_stocks: number | null;
  coverage_brokers: number | null;
  fallback_used_count: number | null;
  duration_ms: number | null;
  error: string | null;
  started_at: string; // ISO
};

export type WaveDecision = {
  wave: number;
  samples: number;
  triggered: boolean;
  reason: 'sealed_false' | 'fallback_high' | 'mixed' | null;
  fallback_rate_avg: number;
  sealed_count: number;
  fallback_threshold: number;
  latest_started_at: string | null;
  detail: {
    trade_dates: string[];
    fallback_used_counts: number[];
    coverage_stocks: number[];
    sealed_flags: boolean[];
  };
};

export const FALLBACK_RATE_THRESHOLD = 0.3;
export const CONSECUTIVE_WINDOW = 3;

function rateOf(m: KeepwarmMetric): number {
  const cov = Number(m.coverage_stocks ?? 0);
  const fb = Number(m.fallback_used_count ?? 0);
  if (cov <= 0) return 1;
  if (m.status === 'error') return 1;
  return Math.min(1, fb / cov);
}

function sealedOf(m: KeepwarmMetric): boolean {
  if (m.status === 'error') return false;
  return Boolean(m.sealed);
}

export function evaluateWave(rows: KeepwarmMetric[]): WaveDecision {
  const wave = rows[0]?.wave ?? 0;
  const sorted = [...rows].sort((a, b) =>
    a.started_at < b.started_at ? 1 : a.started_at > b.started_at ? -1 : 0,
  );
  const latest = sorted.slice(0, CONSECUTIVE_WINDOW);
  const sealedFlags = latest.map(sealedOf);
  const rates = latest.map(rateOf);
  const sealedCount = sealedFlags.filter(Boolean).length;
  const fallbackAvg = rates.length
    ? rates.reduce((s, r) => s + r, 0) / rates.length
    : 0;

  const detail = {
    trade_dates: latest.map((m) => m.trade_date),
    fallback_used_counts: latest.map((m) => Number(m.fallback_used_count ?? 0)),
    coverage_stocks: latest.map((m) => Number(m.coverage_stocks ?? 0)),
    sealed_flags: sealedFlags,
  };

  if (latest.length < CONSECUTIVE_WINDOW) {
    return {
      wave,
      samples: latest.length,
      triggered: false,
      reason: null,
      fallback_rate_avg: fallbackAvg,
      sealed_count: sealedCount,
      fallback_threshold: FALLBACK_RATE_THRESHOLD,
      latest_started_at: latest[0]?.started_at ?? null,
      detail,
    };
  }

  const allSealedFalse = sealedFlags.every((s) => !s);
  const allFallbackHigh = rates.every((r) => r > FALLBACK_RATE_THRESHOLD);

  let triggered = false;
  let reason: WaveDecision['reason'] = null;
  if (allSealedFalse && allFallbackHigh) {
    triggered = true;
    reason = 'mixed';
  } else if (allSealedFalse) {
    triggered = true;
    reason = 'sealed_false';
  } else if (allFallbackHigh) {
    triggered = true;
    reason = 'fallback_high';
  }

  return {
    wave,
    samples: latest.length,
    triggered,
    reason,
    fallback_rate_avg: fallbackAvg,
    sealed_count: sealedCount,
    fallback_threshold: FALLBACK_RATE_THRESHOLD,
    latest_started_at: latest[0].started_at,
    detail,
  };
}

export function evaluateAllWaves(rows: KeepwarmMetric[]): WaveDecision[] {
  const byWave = new Map<number, KeepwarmMetric[]>();
  for (const r of rows) {
    const w = Number(r.wave ?? 0);
    if (!w) continue;
    const arr = byWave.get(w) ?? [];
    arr.push(r);
    byWave.set(w, arr);
  }
  return Array.from(byWave.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, list]) => evaluateWave(list));
}
