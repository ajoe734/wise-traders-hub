// FinMind BSR 自動降級狀態機（純邏輯，可離線單測）。
//
// 狀態機：normal → tier3_paused → tier2_paused → p1_only → claim_halt
//
// | Mode           | max_priority | concurrency | enqueue tier3 | worker claim |
// | -------------- | ------------ | ----------- | ------------- | ------------ |
// | normal         | 3            | 3           | 允許          | 允許         |
// | tier3_paused   | 2            | 3           | 拒絕          | 允許         |
// | tier2_paused   | 1            | 2           | 拒絕          | 允許         |
// | p1_only        | 1            | 1           | 拒絕          | 允許         |
// | claim_halt     | 1            | 0           | 拒絕          | 拒絕（僅回收 lease + 告警）|
//
// 觸發（優先度由高到低）：
//   1) reservation stuck（expired_unsettled ≥ 5 或 oldest_in_flight_age_seconds ≥ 300） → claim_halt
//   2) 用量 ≥ 90% 或 429 連續 ≥ 3 分鐘                                                → tier2_paused
//   3) 用量 ≥ 80% 或 P1 pending 最舊 age ≥ 30 分                                     → tier3_paused
//   否則 → 期望 normal
//
// 恢復：
//   - 必須逐級退回（一次降一階），並在每次轉移後 cooldown 期間內不再動作，避免震盪。
//   - 恢復目標由「當前情境」+「當前 mode 的前一階」共同決定：
//       claim_halt   → p1_only     （expired=0 且 oldest_in_flight < 30s）
//       p1_only      → tier2_paused（用量 < 85% 且 429_streak = 0）
//       tier2_paused → tier3_paused（用量 < 75% 且 429_streak = 0）
//       tier3_paused → normal      （用量 < 70% 且 P1 pending age < 10 分）
//
// Cooldown 預設 600s（10 分鐘）；緊急升級（claim_halt）縮為 60s，快速回收。

export type DegradeMode =
  | 'normal'
  | 'tier3_paused'
  | 'tier2_paused'
  | 'p1_only'
  | 'claim_halt';

export const MODE_ORDER: DegradeMode[] = [
  'normal',
  'tier3_paused',
  'tier2_paused',
  'p1_only',
  'claim_halt',
];

export interface DegradePolicy {
  mode: DegradeMode;
  maxPriority: 1 | 2 | 3;
  concurrency: number;
  allowClaim: boolean;
  allowEnqueueTier3: boolean;
}

export const POLICY: Record<DegradeMode, DegradePolicy> = {
  normal:       { mode: 'normal',       maxPriority: 3, concurrency: 3, allowClaim: true,  allowEnqueueTier3: true  },
  tier3_paused: { mode: 'tier3_paused', maxPriority: 2, concurrency: 3, allowClaim: true,  allowEnqueueTier3: false },
  tier2_paused: { mode: 'tier2_paused', maxPriority: 1, concurrency: 2, allowClaim: true,  allowEnqueueTier3: false },
  p1_only:      { mode: 'p1_only',      maxPriority: 1, concurrency: 1, allowClaim: true,  allowEnqueueTier3: false },
  claim_halt:   { mode: 'claim_halt',   maxPriority: 1, concurrency: 0, allowClaim: false, allowEnqueueTier3: false },
};

export interface Signals {
  usagePct: number;                    // 0..100（含 in-flight）
  rateLimited429Streak: number;        // 連續分鐘 bucket 有 429 的數量
  p1OldestPendingAgeSec: number;
  reservationExpiredUnsettled: number;
  reservationOldestInFlightSec: number;
}

export interface DegradeState {
  mode: DegradeMode;
  since: number;         // epoch ms
  cooldownUntil: number; // epoch ms
}

export interface Decision {
  targetMode: DegradeMode;
  reason: string;
  triggerMetric?: string;
  triggerValue?: number;
  threshold?: number;
  cooldownSeconds: number;
  /** true = 應寫入 transition；false = 保持現狀 */
  shouldTransition: boolean;
}

export const DEFAULT_COOLDOWN_SEC = 600;
export const EMERGENCY_COOLDOWN_SEC = 60;

/** 依當前訊號判斷「理想模式」（不考慮 cooldown / 逐級恢復） */
export function desiredMode(sig: Signals): { mode: DegradeMode; reason: string; metric?: string; value?: number; threshold?: number } {
  if (sig.reservationExpiredUnsettled >= 5 || sig.reservationOldestInFlightSec >= 300) {
    return { mode: 'claim_halt', reason: 'reservation_stuck',
      metric: 'oldest_in_flight_sec', value: sig.reservationOldestInFlightSec, threshold: 300 };
  }
  if (sig.usagePct >= 90) {
    return { mode: 'tier2_paused', reason: 'usage_ge_90', metric: 'usage_pct', value: sig.usagePct, threshold: 90 };
  }
  if (sig.rateLimited429Streak >= 3) {
    return { mode: 'tier2_paused', reason: 'rate_limited_streak', metric: '429_streak_min', value: sig.rateLimited429Streak, threshold: 3 };
  }
  if (sig.usagePct >= 80) {
    return { mode: 'tier3_paused', reason: 'usage_ge_80', metric: 'usage_pct', value: sig.usagePct, threshold: 80 };
  }
  if (sig.p1OldestPendingAgeSec >= 1800) {
    return { mode: 'tier3_paused', reason: 'p1_stalled', metric: 'p1_oldest_sec', value: sig.p1OldestPendingAgeSec, threshold: 1800 };
  }
  return { mode: 'normal', reason: 'healthy' };
}

/** 逐級恢復：從當前 mode 只能退一階，且必須滿足退階條件 */
export function stepDownTarget(current: DegradeMode, sig: Signals): { next: DegradeMode; ok: boolean; reason: string } {
  switch (current) {
    case 'claim_halt':
      return {
        next: 'p1_only',
        ok: sig.reservationExpiredUnsettled === 0 && sig.reservationOldestInFlightSec < 30,
        reason: 'recover_from_claim_halt',
      };
    case 'p1_only':
      return {
        next: 'tier2_paused',
        ok: sig.usagePct < 85 && sig.rateLimited429Streak === 0,
        reason: 'recover_to_tier2_paused',
      };
    case 'tier2_paused':
      return {
        next: 'tier3_paused',
        ok: sig.usagePct < 75 && sig.rateLimited429Streak === 0,
        reason: 'recover_to_tier3_paused',
      };
    case 'tier3_paused':
      return {
        next: 'normal',
        ok: sig.usagePct < 70 && sig.p1OldestPendingAgeSec < 600,
        reason: 'recover_to_normal',
      };
    default:
      return { next: 'normal', ok: false, reason: 'already_normal' };
  }
}

const modeIdx = (m: DegradeMode) => MODE_ORDER.indexOf(m);

/**
 * 主決策函式。輸入當前狀態與訊號、目前時間（ms），回傳是否要進行狀態轉移。
 *
 * 規則：
 *  - 若「理想模式」比當前嚴格 → 立即升級（emergency cooldown）。
 *  - 若「理想模式」比當前寬鬆 → 需 cooldown 到期，且只能退一階（且要滿足退階條件）。
 *  - 否則保持不變。
 */
export function decide(current: DegradeState, sig: Signals, nowMs: number): Decision {
  const want = desiredMode(sig);
  const curIdx = modeIdx(current.mode);
  const wantIdx = modeIdx(want.mode);

  // 升級（更嚴格）：忽略 cooldown
  if (wantIdx > curIdx) {
    return {
      targetMode: want.mode,
      reason: want.reason,
      triggerMetric: want.metric,
      triggerValue: want.value,
      threshold: want.threshold,
      cooldownSeconds: want.mode === 'claim_halt' ? EMERGENCY_COOLDOWN_SEC : DEFAULT_COOLDOWN_SEC,
      shouldTransition: true,
    };
  }

  // 相同：不動
  if (wantIdx === curIdx) {
    return {
      targetMode: current.mode,
      reason: 'no_change',
      cooldownSeconds: 0,
      shouldTransition: false,
    };
  }

  // 降級（希望寬鬆）：需要 cooldown 到期 + 逐級 + 退階條件
  if (nowMs < current.cooldownUntil) {
    return {
      targetMode: current.mode,
      reason: 'cooldown_active',
      cooldownSeconds: 0,
      shouldTransition: false,
    };
  }

  const step = stepDownTarget(current.mode, sig);
  if (!step.ok) {
    return {
      targetMode: current.mode,
      reason: 'step_down_conditions_not_met',
      cooldownSeconds: 0,
      shouldTransition: false,
    };
  }

  return {
    targetMode: step.next,
    reason: step.reason,
    cooldownSeconds: DEFAULT_COOLDOWN_SEC,
    shouldTransition: true,
  };
}

/** UI / worker 讀取當前 mode 的 policy */
export function policyOf(mode: DegradeMode): DegradePolicy {
  return POLICY[mode] ?? POLICY.normal;
}

/** 給 worker 用：把外部 `body.max_priority` 與 policy 交集 */
export function effectiveMaxPriority(mode: DegradeMode, requested: number): 1 | 2 | 3 {
  const cap = policyOf(mode).maxPriority;
  const r = Math.max(1, Math.min(3, Math.floor(requested))) as 1 | 2 | 3;
  return Math.min(cap, r) as 1 | 2 | 3;
}
