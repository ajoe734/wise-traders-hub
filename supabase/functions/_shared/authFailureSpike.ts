// supabase/functions/_shared/authFailureSpike.ts
//
// Phase M-3a: pure decision logic for edge function auth failure spikes.
// Consumed by alerts-watchdog. Kept pure so it is unit-testable with Deno test.

export type AuthEventRow = {
  fn_name: string;
  auth_class: string;
  outcome: number;
  code: string | null;
  created_at: string;
};

export type SpikeThresholds = {
  /** minimum failures in the window for a given fn_name to warrant an alert */
  warnMin: number;
  /** failure count at which the alert escalates to critical */
  criticalMin: number;
  /** window minutes (used only for message/detail; caller filters rows) */
  windowMin: number;
};

export const DEFAULT_SPIKE_THRESHOLDS: SpikeThresholds = {
  warnMin: 10,
  criticalMin: 30,
  windowMin: 15,
};

export type SpikeDecision = {
  fn_name: string;
  auth_class: string;
  outcome_breakdown: Record<string, number>;
  total: number;
  distinct_ips: number;
  triggered: boolean;
  level: 'warning' | 'critical' | null;
  reason: string | null;
};

export function evaluateSpikes(
  rows: AuthEventRow[],
  thresholds: SpikeThresholds = DEFAULT_SPIKE_THRESHOLDS,
  ipByFn?: Map<string, Set<string>>,
): SpikeDecision[] {
  const byFn = new Map<string, AuthEventRow[]>();
  for (const r of rows) {
    if (r.outcome < 400) continue;
    const arr = byFn.get(r.fn_name) ?? [];
    arr.push(r);
    byFn.set(r.fn_name, arr);
  }
  const out: SpikeDecision[] = [];
  for (const [fn, arr] of byFn) {
    const breakdown: Record<string, number> = {};
    for (const r of arr) {
      const key = `${r.outcome}${r.code ? `:${r.code}` : ''}`;
      breakdown[key] = (breakdown[key] ?? 0) + 1;
    }
    const total = arr.length;
    const level: 'critical' | 'warning' | null = total >= thresholds.criticalMin
      ? 'critical'
      : total >= thresholds.warnMin
        ? 'warning'
        : null;
    out.push({
      fn_name: fn,
      auth_class: arr[0].auth_class,
      outcome_breakdown: breakdown,
      total,
      distinct_ips: ipByFn?.get(fn)?.size ?? 0,
      triggered: level !== null,
      level,
      reason: level ? `${total} 次驗證失敗 / ${thresholds.windowMin} 分鐘` : null,
    });
  }
  // most severe first
  out.sort((a, b) => b.total - a.total);
  return out;
}
