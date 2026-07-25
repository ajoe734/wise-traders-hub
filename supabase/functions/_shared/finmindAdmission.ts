// PR-8: FinMind Quota Admission Control
// 三 pool 隔離：interactive / keepwarm / backfill
// admit() 呼叫前先檢查 kill-switch + circuit，再原子扣配額。
//
// 使用方式：
//   const gate = await admitFinmind(supa, {
//     pool: 'keepwarm',
//     kind: 'keepwarm_wave1',
//     stockId: '2330',
//   });
//   if (!gate.granted) { /* skip this call, log reason */ }
//
// reason 可能值：
//   - 'quota_exceeded'    → 當日配額用完
//   - 'kill_switch_off'   → 對應 pool 的 kill-switch 已關閉
//   - 'circuit_open'      → 上游熔斷中
//   - 'unknown_pool'      → pool 名稱錯誤
//   - 'admission_error'   → RPC 呼叫失敗（放行 fail-open，避免變 SPOF）
//   - 'ok'                → 允許

import { checkCircuit } from './circuitBreaker.ts';
import { checkKillSwitch } from './killSwitch.ts';

export type FinmindPool = 'interactive' | 'keepwarm' | 'backfill';

const POOL_TO_SWITCH: Record<FinmindPool, string> = {
  interactive: 'chips_interactive',
  keepwarm: 'chips_keepwarm',
  backfill: 'chips_backfill',
};

export interface AdmitInput {
  pool: FinmindPool;
  kind: string;
  stockId?: string | null;
  cost?: number;
  circuitSource?: string; // 預設 finmind_bsr
  skipCircuit?: boolean;
}

export interface AdmitResult {
  granted: boolean;
  reason: string;
  remaining?: number;
  reset_at?: string;
}

export async function admitFinmind(supa: any, input: AdmitInput): Promise<AdmitResult> {
  const pool = input.pool;
  const switchKey = POOL_TO_SWITCH[pool];

  // 1. Kill-switch 檢查（含 chips_all）
  const enabled = await checkKillSwitch(supa, switchKey);
  if (!enabled) {
    return { granted: false, reason: 'kill_switch_off' };
  }

  // 2. Circuit 檢查（除非明確 skip；guardian 自己判斷時會 skip）
  if (!input.skipCircuit) {
    const gate = await checkCircuit(supa, input.circuitSource ?? 'finmind_bsr');
    if (!gate.allowed) {
      return { granted: false, reason: 'circuit_open' };
    }
  }

  // 3. Quota admission（RPC）
  try {
    const { data, error } = await supa.rpc('finmind_admit', {
      _pool: pool,
      _kind: input.kind,
      _stock_id: input.stockId ?? null,
      _cost: input.cost ?? 1,
    });
    if (error) {
      console.warn('[admission] rpc error, fail-open:', error.message);
      return { granted: true, reason: 'admission_error' };
    }
    const obj = (data ?? {}) as Record<string, unknown>;
    return {
      granted: Boolean(obj.granted),
      reason: String(obj.reason ?? 'unknown'),
      remaining: typeof obj.remaining === 'number' ? obj.remaining : undefined,
      reset_at: typeof obj.reset_at === 'string' ? obj.reset_at : undefined,
    };
  } catch (e) {
    console.warn('[admission] exception, fail-open:', (e as Error).message);
    return { granted: true, reason: 'admission_error' };
  }
}

/** 僅記帳（不做決策）：kill-switch 或 circuit 已拒時，寫一筆 rejected ledger 便於歸因。 */
export async function logAdmissionRejection(
  supa: any,
  pool: FinmindPool,
  kind: string,
  stockId: string | null,
  reason: string,
): Promise<void> {
  try {
    await supa.from('finmind_quota_ledger').insert({
      pool_name: pool,
      request_kind: kind,
      stock_id: stockId,
      granted: false,
      reason,
    });
  } catch {
    /* swallow */
  }
}
