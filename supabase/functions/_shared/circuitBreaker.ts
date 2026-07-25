// PR-7: 上游來源熔斷器（Circuit Breaker）
// 使用 public.data_source_health 作為狀態存放：
//   - circuit_state: 'closed' | 'open' | 'half_open'
//   - consecutive_failures / ok_count_10m / fail_count_10m
//   - disabled_until: OPEN 冷卻結束時間
//
// 狀態機：
//   closed →（連續失敗 >= FAILURE_STREAK 或 10 分鐘內失敗 >= FAIL_WINDOW_MAX
//             且成功數 < OK_WINDOW_MIN）→ open（冷卻 COOLDOWN_MS）
//   open   →（now >= disabled_until）→ half_open
//   half_open →（下一次成功）→ closed
//              →（下一次失敗）→ open（冷卻加倍，上限 COOLDOWN_MAX_MS）
//
// 對外 API：
//   checkCircuit(supa, source)          → { allowed, state, disabled_until, reason }
//   recordCircuit(supa, source, ok, latencyMs, errCode?) → 更新統計 & 狀態
//   deriveNextState(prev, ok)           → 純函式，供單元測試

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitRow {
  source: string;
  circuit_state: CircuitState;
  consecutive_failures: number;
  ok_count_10m: number;
  fail_count_10m: number;
  disabled_until: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error_code: string | null;
  p95_latency_ms: number | null;
  updated_at: string;
}

export const CB_CONFIG = {
  FAILURE_STREAK: 5,        // 連續失敗數觸發 open
  FAIL_WINDOW_MAX: 10,      // 10 分鐘視窗內失敗上限
  OK_WINDOW_MIN: 3,         // 10 分鐘視窗內至少成功數（不足才熔）
  COOLDOWN_MS: 5 * 60_000,  // 首次 open 冷卻
  COOLDOWN_MAX_MS: 30 * 60_000, // 冷卻上限
  WINDOW_MS: 10 * 60_000,   // 滾動視窗長度（超過就重置 10m 計數）
} as const;

export interface DeriveInput {
  prev: Partial<CircuitRow> | null;
  ok: boolean;
  now?: Date;
  errCode?: string;
  latencyMs?: number;
}

export interface DeriveOutput {
  circuit_state: CircuitState;
  consecutive_failures: number;
  ok_count_10m: number;
  fail_count_10m: number;
  disabled_until: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error_code: string | null;
  p95_latency_ms: number | null;
  updated_at: string;
  // 觀測用
  transition?: 'closed→open' | 'open→half_open' | 'half_open→closed' | 'half_open→open';
  cooldown_ms?: number;
}

/** 純函式：計算下一個 circuit 狀態。無 IO，直接單測。 */
export function deriveNextState(input: DeriveInput): DeriveOutput {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const prev = input.prev ?? {};
  const prevState = (prev.circuit_state as CircuitState) ?? 'closed';
  const lastUpdated = prev.updated_at ? new Date(prev.updated_at).getTime() : 0;
  const windowExpired = now.getTime() - lastUpdated > CB_CONFIG.WINDOW_MS;

  const ok_count_10m = (windowExpired ? 0 : (prev.ok_count_10m ?? 0)) + (input.ok ? 1 : 0);
  const fail_count_10m = (windowExpired ? 0 : (prev.fail_count_10m ?? 0)) + (input.ok ? 0 : 1);
  const consecutive_failures = input.ok ? 0 : (prev.consecutive_failures ?? 0) + 1;

  // 冷卻時長：half_open 再爆 → 加倍
  const prevCooldown = prev.disabled_until && prev.last_failure_at
    ? new Date(prev.disabled_until).getTime() - new Date(prev.last_failure_at).getTime()
    : CB_CONFIG.COOLDOWN_MS;
  const nextCooldown = Math.min(
    CB_CONFIG.COOLDOWN_MAX_MS,
    Math.max(CB_CONFIG.COOLDOWN_MS, prevCooldown * 2),
  );

  let circuit_state: CircuitState = prevState;
  let disabled_until: string | null = prev.disabled_until ?? null;
  let transition: DeriveOutput['transition'] | undefined;
  let cooldown_ms: number | undefined;

  // half_open 判定：open 狀態且冷卻已過
  if (prevState === 'open' && prev.disabled_until && now.getTime() >= new Date(prev.disabled_until).getTime()) {
    circuit_state = 'half_open';
    transition = 'open→half_open';
    disabled_until = null;
  }

  if (input.ok) {
    if (circuit_state === 'half_open') {
      circuit_state = 'closed';
      transition = 'half_open→closed';
      disabled_until = null;
    }
  } else {
    if (circuit_state === 'half_open') {
      // 半開探測失敗 → 重新 open，冷卻加倍
      circuit_state = 'open';
      disabled_until = new Date(now.getTime() + nextCooldown).toISOString();
      cooldown_ms = nextCooldown;
      transition = 'half_open→open';
    } else if (circuit_state === 'closed') {
      const streakTrip = consecutive_failures >= CB_CONFIG.FAILURE_STREAK;
      const windowTrip = fail_count_10m >= CB_CONFIG.FAIL_WINDOW_MAX
        && ok_count_10m < CB_CONFIG.OK_WINDOW_MIN;
      if (streakTrip || windowTrip) {
        circuit_state = 'open';
        disabled_until = new Date(now.getTime() + CB_CONFIG.COOLDOWN_MS).toISOString();
        cooldown_ms = CB_CONFIG.COOLDOWN_MS;
        transition = 'closed→open';
      }
    }
  }

  return {
    circuit_state,
    consecutive_failures,
    ok_count_10m,
    fail_count_10m,
    disabled_until,
    last_success_at: input.ok ? nowIso : (prev.last_success_at ?? null),
    last_failure_at: input.ok ? (prev.last_failure_at ?? null) : nowIso,
    last_error_code: input.ok ? (prev.last_error_code ?? null) : (input.errCode ?? 'unknown'),
    p95_latency_ms: typeof input.latencyMs === 'number' ? input.latencyMs : (prev.p95_latency_ms ?? null),
    updated_at: nowIso,
    transition,
    cooldown_ms,
  };
}

export interface CheckResult {
  allowed: boolean;
  state: CircuitState;
  disabled_until: string | null;
  reason?: string;
}

/** 讀取 data_source_health，回傳目前是否允許呼叫上游。 */
export async function checkCircuit(supa: any, source: string): Promise<CheckResult> {
  try {
    const { data } = await supa
      .from('data_source_health')
      .select('circuit_state, disabled_until')
      .eq('source', source)
      .maybeSingle();
    const state = (data?.circuit_state as CircuitState) ?? 'closed';
    const disabled_until: string | null = data?.disabled_until ?? null;
    if (state === 'open' && disabled_until && Date.now() < new Date(disabled_until).getTime()) {
      return { allowed: false, state, disabled_until, reason: 'circuit_open' };
    }
    // open 但冷卻已過 → half_open 探測；closed / half_open 皆允許
    return { allowed: true, state: state === 'open' ? 'half_open' : state, disabled_until };
  } catch {
    // 讀取失敗一律放行，避免熔斷器本身變 SPOF
    return { allowed: true, state: 'closed', disabled_until: null, reason: 'health_read_failed' };
  }
}

/** 記錄一次上游呼叫結果，並依 deriveNextState 更新資料表。 */
export async function recordCircuit(
  supa: any,
  source: string,
  ok: boolean,
  latencyMs: number,
  errCode?: string,
): Promise<DeriveOutput | null> {
  try {
    const { data: prev } = await supa
      .from('data_source_health')
      .select('*')
      .eq('source', source)
      .maybeSingle();
    const next = deriveNextState({ prev, ok, errCode, latencyMs });
    const patch = {
      source,
      circuit_state: next.circuit_state,
      consecutive_failures: next.consecutive_failures,
      ok_count_10m: next.ok_count_10m,
      fail_count_10m: next.fail_count_10m,
      disabled_until: next.disabled_until,
      last_success_at: next.last_success_at,
      last_failure_at: next.last_failure_at,
      last_error_code: next.last_error_code,
      p95_latency_ms: next.p95_latency_ms,
      updated_at: next.updated_at,
    };
    await supa.from('data_source_health').upsert(patch, { onConflict: 'source' });
    if (next.transition) {
      console.log(`[circuit-breaker] ${source} ${next.transition}`, {
        cooldown_ms: next.cooldown_ms,
        consecutive_failures: next.consecutive_failures,
        fail_10m: next.fail_count_10m,
        errCode,
      });
    }
    return next;
  } catch (e) {
    console.warn(`[circuit-breaker] record failed for ${source}:`, (e as Error).message);
    return null;
  }
}
