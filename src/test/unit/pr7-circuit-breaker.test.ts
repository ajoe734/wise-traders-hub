// PR-7 單元測試：circuitBreaker.deriveNextState
// 覆蓋 closed→open（連續 & 視窗）、open→half_open、half_open→closed、half_open→open（加倍冷卻）、視窗過期重置
import { describe, it, expect } from 'vitest';
import {
  deriveNextState,
  CB_CONFIG,
  type CircuitRow,
} from '../../../supabase/functions/_shared/circuitBreaker.ts';

const T0 = new Date('2026-07-25T12:00:00.000Z');
function at(ms: number) { return new Date(T0.getTime() + ms); }
function baseline(overrides: Partial<CircuitRow> = {}): Partial<CircuitRow> {
  return {
    source: 'test',
    circuit_state: 'closed',
    consecutive_failures: 0,
    ok_count_10m: 0,
    fail_count_10m: 0,
    disabled_until: null,
    last_success_at: null,
    last_failure_at: null,
    last_error_code: null,
    p95_latency_ms: null,
    updated_at: T0.toISOString(),
    ...overrides,
  };
}

describe('PR-7 circuit breaker deriveNextState', () => {
  it('closed 連續 FAILURE_STREAK 次失敗 → open，冷卻 COOLDOWN_MS', () => {
    let prev: any = baseline();
    let last: any;
    for (let i = 0; i < CB_CONFIG.FAILURE_STREAK; i++) {
      last = deriveNextState({ prev, ok: false, now: at(i * 1000), errCode: 'http_500' });
      prev = last;
    }
    expect(last.circuit_state).toBe('open');
    expect(last.transition).toBe('closed→open');
    expect(last.consecutive_failures).toBe(CB_CONFIG.FAILURE_STREAK);
    expect(last.cooldown_ms).toBe(CB_CONFIG.COOLDOWN_MS);
    expect(last.disabled_until).not.toBeNull();
  });

  it('closed 未達連續 threshold 但視窗內 fail 過多、成功不足 → open', () => {
    const prev = baseline({
      fail_count_10m: CB_CONFIG.FAIL_WINDOW_MAX - 1,
      ok_count_10m: CB_CONFIG.OK_WINDOW_MIN - 1,
      consecutive_failures: 2,
    });
    const next = deriveNextState({ prev, ok: false, now: at(0) });
    expect(next.circuit_state).toBe('open');
    expect(next.transition).toBe('closed→open');
  });

  it('視窗內 fail 多但成功數達標 → 不熔', () => {
    const prev = baseline({
      fail_count_10m: CB_CONFIG.FAIL_WINDOW_MAX - 1,
      ok_count_10m: CB_CONFIG.OK_WINDOW_MIN,
      consecutive_failures: 1,
    });
    const next = deriveNextState({ prev, ok: false, now: at(0) });
    expect(next.circuit_state).toBe('closed');
  });

  it('open 冷卻結束後 → half_open', () => {
    const openUntil = at(CB_CONFIG.COOLDOWN_MS);
    const prev = baseline({
      circuit_state: 'open',
      disabled_until: openUntil.toISOString(),
      last_failure_at: T0.toISOString(),
      consecutive_failures: 5,
    });
    // 探測請求成功
    const next = deriveNextState({ prev, ok: true, now: at(CB_CONFIG.COOLDOWN_MS + 1000) });
    expect(next.circuit_state).toBe('closed');
    expect(next.transition).toBe('half_open→closed');
    expect(next.disabled_until).toBeNull();
    expect(next.consecutive_failures).toBe(0);
  });

  it('half_open 探測失敗 → 再度 open，冷卻加倍', () => {
    const openUntil = at(CB_CONFIG.COOLDOWN_MS);
    const prev = baseline({
      circuit_state: 'open',
      disabled_until: openUntil.toISOString(),
      last_failure_at: T0.toISOString(),
      consecutive_failures: 5,
    });
    const next = deriveNextState({ prev, ok: false, now: at(CB_CONFIG.COOLDOWN_MS + 1000), errCode: 'http_502' });
    expect(next.circuit_state).toBe('open');
    expect(next.transition).toBe('half_open→open');
    expect(next.cooldown_ms).toBeGreaterThanOrEqual(CB_CONFIG.COOLDOWN_MS * 2);
    expect(next.cooldown_ms).toBeLessThanOrEqual(CB_CONFIG.COOLDOWN_MAX_MS);
  });

  it('冷卻加倍受 COOLDOWN_MAX_MS 限制', () => {
    // 前次冷卻已達上限
    const prev = baseline({
      circuit_state: 'open',
      disabled_until: at(CB_CONFIG.COOLDOWN_MAX_MS).toISOString(),
      last_failure_at: T0.toISOString(),
      consecutive_failures: 20,
    });
    const next = deriveNextState({ prev, ok: false, now: at(CB_CONFIG.COOLDOWN_MAX_MS + 1000) });
    expect(next.cooldown_ms).toBe(CB_CONFIG.COOLDOWN_MAX_MS);
  });

  it('WINDOW_MS 過期後 10m 計數重置', () => {
    const prev = baseline({
      fail_count_10m: 8,
      ok_count_10m: 1,
      updated_at: T0.toISOString(),
    });
    // 距上次更新超過 WINDOW_MS
    const next = deriveNextState({ prev, ok: false, now: at(CB_CONFIG.WINDOW_MS + 60_000) });
    expect(next.fail_count_10m).toBe(1);  // 重置後 +1
    expect(next.ok_count_10m).toBe(0);
    expect(next.circuit_state).toBe('closed');
  });

  it('成功呼叫在 closed 狀態下不改變 state，consecutive_failures 歸零', () => {
    const prev = baseline({ consecutive_failures: 3, fail_count_10m: 3 });
    const next = deriveNextState({ prev, ok: true, now: at(0), latencyMs: 120 });
    expect(next.circuit_state).toBe('closed');
    expect(next.consecutive_failures).toBe(0);
    expect(next.p95_latency_ms).toBe(120);
    expect(next.last_success_at).not.toBeNull();
  });

  it('open 尚未冷卻結束 → 保持 open，不進 half_open', () => {
    const prev = baseline({
      circuit_state: 'open',
      disabled_until: at(CB_CONFIG.COOLDOWN_MS).toISOString(),
      last_failure_at: T0.toISOString(),
      consecutive_failures: 5,
    });
    // 冷卻中收到成功事件（理論上不該發生，但要防呆）
    const next = deriveNextState({ prev, ok: true, now: at(60_000) });
    expect(next.circuit_state).toBe('open');
    expect(next.transition).toBeUndefined();
  });
});
