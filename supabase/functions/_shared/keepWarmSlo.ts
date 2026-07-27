// Phase I — Keep-warm SLO 純邏輯。
//
// 規則：每個 wave 從 tw_bsr_keepwarm_metrics 讀最新運行狀態：
//   - 完全沒紀錄 → critical, reason='missing'
//   - 最新 started_at 距 now 超過 expectedIntervalMin + LATE_CRIT_MIN → critical, reason='late'
//   - 超過 expectedIntervalMin + LATE_WARN_MIN → warning, reason='late'
//   - 最新 2 筆 status 都不是 'ok' → critical, reason='consecutive_failed'
//   - 否則正常，不觸發

export const LATE_WARN_MIN = 30;
export const LATE_CRIT_MIN = 120;

export type SloRow = {
  wave: number;
  started_at: string; // ISO
  status: string | null;
};

export type SloReason = 'missing' | 'late' | 'consecutive_failed' | null;

export type SloDecision = {
  wave: number;
  triggered: boolean;
  level: 'warning' | 'critical' | null;
  reason: SloReason;
  age_min: number | null;
  expected_interval_min: number;
  latest_started_at: string | null;
  latest_status: string | null;
  detail: {
    sample_count: number;
    recent_statuses: string[];
  };
};

function sortDesc(rows: SloRow[]): SloRow[] {
  return [...rows].sort((a, b) =>
    a.started_at < b.started_at ? 1 : a.started_at > b.started_at ? -1 : 0,
  );
}

export function evaluateWaveSlo(
  wave: number,
  rows: SloRow[],
  now: number,
  expectedIntervalMin: number,
): SloDecision {
  const scoped = sortDesc(rows.filter((r) => Number(r.wave) === wave));
  const base: SloDecision = {
    wave,
    triggered: false,
    level: null,
    reason: null,
    age_min: null,
    expected_interval_min: expectedIntervalMin,
    latest_started_at: null,
    latest_status: null,
    detail: {
      sample_count: scoped.length,
      recent_statuses: scoped.slice(0, 3).map((r) => r.status ?? 'null'),
    },
  };

  if (scoped.length === 0) {
    return { ...base, triggered: true, level: 'critical', reason: 'missing' };
  }

  const latest = scoped[0];
  const ageMin = Math.max(0, Math.round((now - new Date(latest.started_at).getTime()) / 60_000));
  base.age_min = ageMin;
  base.latest_started_at = latest.started_at;
  base.latest_status = latest.status ?? null;

  // Consecutive failure takes priority over lateness.
  if (scoped.length >= 2 && scoped.slice(0, 2).every((r) => r.status !== 'ok')) {
    return { ...base, triggered: true, level: 'critical', reason: 'consecutive_failed' };
  }

  const lateBy = ageMin - expectedIntervalMin;
  if (lateBy > LATE_CRIT_MIN) {
    return { ...base, triggered: true, level: 'critical', reason: 'late' };
  }
  if (lateBy > LATE_WARN_MIN) {
    return { ...base, triggered: true, level: 'warning', reason: 'late' };
  }

  return base;
}

export function evaluateAllWaveSlo(
  rows: SloRow[],
  now: number,
  expectedByWave: Record<number, number>,
): SloDecision[] {
  return Object.keys(expectedByWave)
    .map((k) => Number(k))
    .sort((a, b) => a - b)
    .map((wave) => evaluateWaveSlo(wave, rows, now, expectedByWave[wave]));
}
