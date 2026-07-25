// Phase-2 / PR-10: Pure decision functions extracted from chips-guardian.
// 這些函式無 IO、無隨機、無時間依賴（時間以 input.nowMs 傳入），可用 vitest 測。
// Guardian edge function 只負責讀寫 DB + 呼叫這些純函式。
//
// 常數與 chips-guardian/index.ts 對齊；若調整，必須同時重跑
// scripts/record-guardian-golden.mjs 並更新 docs/ops/chips-pipeline-runbook.md §2。

export const SLO_TIGHTEN_THRESHOLD = 0.5;
export const SLO_RELAX_THRESHOLD = 0.05;
export const SLO_MIN_MULTIPLIER = 0.5;
export const SLO_MAX_MULTIPLIER = 2.0;
export const SLO_SAMPLE_MIN = 30;
export const SLO_BOOST_MS = 2 * 3600 * 1000;
export const UPSTREAM_LOW_THRESHOLD_DEFAULT = 100;
export const UPSTREAM_THROTTLE_RATIO = 0.3;
export const UPSTREAM_MIN_REFILL = 0.1;

export interface SloAdjustInput {
  poolName: string;
  currentBudget: number;
  baseCapacity: number;
  /** Boost 到期時間（毫秒 epoch）。null = 尚未 boost。 */
  boostUntilMs: number | null;
  manualOverride: boolean;
  /** 觀察窗內樣本數。 */
  totalSamples: number;
  /** 觀察窗內拒絕率 [0,1]。 */
  rejectRate: number;
  nowMs: number;
}

export interface SloAdjustDecision {
  changed: boolean;
  targetBudget: number;
  /** 新 boost 到期時間；null = 清除。undefined = 不動。 */
  newBoostUntilMs: number | null | undefined;
  reason:
    | 'skipped_interactive'
    | 'skipped_manual_override'
    | 'skipped_undersampled'
    | 'tighten'
    | 'relax_within_base'
    | 'relax_boost'
    | 'boost_expired_reset'
    | 'noop';
}

/**
 * 純函式：決定要不要調整 pool 的 daily_budget。
 * 邏輯與原 chips-guardian ruleSloBudgetAdjust 對齊。
 */
export function decideSloAdjustment(input: SloAdjustInput): SloAdjustDecision {
  if (input.poolName === 'interactive') {
    return { changed: false, targetBudget: input.currentBudget, newBoostUntilMs: undefined, reason: 'skipped_interactive' };
  }
  if (input.manualOverride) {
    return { changed: false, targetBudget: input.currentBudget, newBoostUntilMs: undefined, reason: 'skipped_manual_override' };
  }
  if (input.totalSamples < SLO_SAMPLE_MIN) {
    return { changed: false, targetBudget: input.currentBudget, newBoostUntilMs: undefined, reason: 'skipped_undersampled' };
  }

  const base = input.baseCapacity;
  const current = input.currentBudget;

  // Boost 過期優先處理
  if (input.boostUntilMs !== null && input.boostUntilMs < input.nowMs && current > base) {
    return { changed: true, targetBudget: base, newBoostUntilMs: null, reason: 'boost_expired_reset' };
  }

  if (input.rejectRate >= SLO_TIGHTEN_THRESHOLD) {
    const target = Math.max(Math.floor(base * SLO_MIN_MULTIPLIER), Math.floor(current * 0.8));
    if (target === current && input.boostUntilMs === null) {
      return { changed: false, targetBudget: current, newBoostUntilMs: undefined, reason: 'noop' };
    }
    return { changed: true, targetBudget: target, newBoostUntilMs: null, reason: 'tighten' };
  }

  if (input.rejectRate <= SLO_RELAX_THRESHOLD) {
    const target = Math.min(Math.floor(base * SLO_MAX_MULTIPLIER), Math.floor(current * 1.25));
    if (target > base) {
      return {
        changed: true,
        targetBudget: target,
        newBoostUntilMs: input.nowMs + SLO_BOOST_MS,
        reason: 'relax_boost',
      };
    }
    if (target === current) {
      return { changed: false, targetBudget: current, newBoostUntilMs: undefined, reason: 'noop' };
    }
    return { changed: true, targetBudget: target, newBoostUntilMs: undefined, reason: 'relax_within_base' };
  }

  return { changed: false, targetBudget: current, newBoostUntilMs: undefined, reason: 'noop' };
}

export interface UpstreamThrottleInput {
  sources: Array<{ source: string; upstream_quota_remaining: number | null }>;
  threshold?: number;
}

export interface UpstreamThrottleDecision {
  throttle: boolean;
  lowSource?: string;
  remaining?: number;
  /** 建議乘數；nan → 不動。 */
  refillMultiplier: number;
  minRefill: number;
}

export function decideUpstreamThrottle(input: UpstreamThrottleInput): UpstreamThrottleDecision {
  const threshold = input.threshold ?? UPSTREAM_LOW_THRESHOLD_DEFAULT;
  const low = input.sources.find(
    (r) => r.upstream_quota_remaining != null && r.upstream_quota_remaining < threshold,
  );
  if (!low) {
    return { throttle: false, refillMultiplier: 1, minRefill: UPSTREAM_MIN_REFILL };
  }
  return {
    throttle: true,
    lowSource: low.source,
    remaining: low.upstream_quota_remaining ?? undefined,
    refillMultiplier: UPSTREAM_THROTTLE_RATIO,
    minRefill: UPSTREAM_MIN_REFILL,
  };
}

/** 從 refillMultiplier 計算新的 refill_per_min，套用地板保護。 */
export function computeThrottledRefill(currentPerMin: number, multiplier: number): number {
  return Math.max(UPSTREAM_MIN_REFILL, Number(currentPerMin) * multiplier);
}
