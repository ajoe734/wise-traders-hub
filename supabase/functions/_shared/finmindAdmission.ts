// PR-8 / Phase-1: FinMind Quota Admission Control
// 三 pool 隔離：interactive / keepwarm / backfill
//
// Phase-1 修正：
//   - 預設 fail-CLOSED（RPC 錯誤或例外時拒絕），避免上游熔斷時 admission 反而失守
//   - 保留 opt-in `failOpen` 給明確可容忍的呼叫端使用
//   - kill-switch / circuit 拒絕時也寫 ledger，讓 guardian 能歸因
//   - ledger 加寫 root cause hint（放在 reason 欄位，Phase-2 遷到獨立欄）

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
  /** 預設 false（fail-closed）；只有可犧牲、非關鍵背景任務才傳 true。 */
  failOpen?: boolean;
}

export interface AdmitResult {
  granted: boolean;
  reason: string;
  remaining?: number;
  reset_at?: string;
  /** Phase-2: 若本次為向低優先權借額度，填入來源 pool。 */
  borrowed_from?: FinmindPool;
}

async function writeRejectLedger(
  supa: any,
  pool: FinmindPool,
  kind: string,
  stockId: string | null | undefined,
  reason: string,
  rootCauseHint?: string,
): Promise<void> {
  try {
    await supa.from('finmind_quota_ledger').insert({
      pool_name: pool,
      request_kind: kind,
      stock_id: stockId ?? null,
      granted: false,
      reason,
      root_cause_hint: rootCauseHint ?? reason,
    });
  } catch {
    /* swallow — ledger 是輔助訊號，不能反過來阻斷主流程 */
  }
}

/**
 * PR-10 rollback flag：`FINMIND_ADMIT_LEGACY=1` 時走舊 v1 RPC `finmind_admit`。
 * 副作用：token bucket / 借用 / SLO boost / borrowed_from ledger 全失效，
 *         DataSourceHealth 面板 Token Bucket 欄位會顯示異常。
 * 使用場景：v2 出致命 bug 時應急切換；上線後 3 天綠燈可移除。
 * v1 RPC 存在確認：20260725160922 / 162913 兩支 v2 migration 均未 DROP `finmind_admit`。
 */
function useLegacyAdmit(): boolean {
  try {
    return Deno.env.get('FINMIND_ADMIT_LEGACY') === '1';
  } catch {
    return false;
  }
}

export async function admitFinmind(supa: any, input: AdmitInput): Promise<AdmitResult> {
  const pool = input.pool;
  const switchKey = POOL_TO_SWITCH[pool];
  const failOpen = input.failOpen === true;
  const legacy = useLegacyAdmit();

  // 1. Kill-switch
  const enabled = await checkKillSwitch(supa, switchKey);
  if (!enabled) {
    await writeRejectLedger(supa, pool, input.kind, input.stockId, 'kill_switch_off', `killswitch:${switchKey}`);
    return { granted: false, reason: 'kill_switch_off' };
  }

  // 2. Circuit
  if (!input.skipCircuit) {
    const source = input.circuitSource ?? 'finmind_bsr';
    const gate = await checkCircuit(supa, source);
    if (!gate.allowed) {
      await writeRejectLedger(supa, pool, input.kind, input.stockId, 'circuit_open', `circuit:${source}`);
      return { granted: false, reason: 'circuit_open' };
    }
  }

  // 3. Quota admission RPC — 預設 v2（token bucket + 借用）；LEGACY flag → v1。
  const rpcName = legacy ? 'finmind_admit' : 'finmind_admit_v2';
  const rpcArgs: Record<string, unknown> = legacy
    ? {
        _pool: pool,
        _kind: input.kind,
        _stock_id: input.stockId ?? null,
        _cost: input.cost ?? 1,
      }
    : {
        _pool: pool,
        _kind: input.kind,
        _stock_id: input.stockId ?? null,
        _cost: input.cost ?? 1,
        _allow_borrow: pool === 'interactive',
      };

  try {
    if (legacy) console.warn('[admission] LEGACY mode: FINMIND_ADMIT_LEGACY=1');
    const { data, error } = await supa.rpc(rpcName, rpcArgs);
    if (error) {
      console.warn(`[admission] ${rpcName} error:`, error.message, 'failOpen=', failOpen);
      await writeRejectLedger(supa, pool, input.kind, input.stockId, 'admission_rpc_error', `rpc:${error.message?.slice(0, 80)}`);
      return { granted: failOpen, reason: 'admission_rpc_error' };
    }
    // Edge case：RPC 回 { data: null, error: null } — 視為未知，走 fail-closed
    if (data == null) {
      await writeRejectLedger(supa, pool, input.kind, input.stockId, 'admission_null_payload', `rpc:${rpcName}:null`);
      return { granted: failOpen, reason: 'admission_null_payload' };
    }
    const obj = data as Record<string, unknown>;
    const borrowedFrom = typeof obj.borrowed_from === 'string'
      ? (obj.borrowed_from as FinmindPool)
      : undefined;
    return {
      granted: Boolean(obj.granted),
      reason: String(obj.reason ?? 'unknown'),
      remaining: typeof obj.remaining === 'number' ? obj.remaining : undefined,
      reset_at: typeof obj.reset_at === 'string' ? obj.reset_at : undefined,
      borrowed_from: borrowedFrom,
    };
  } catch (e) {
    console.warn(`[admission] ${rpcName} exception:`, (e as Error).message, 'failOpen=', failOpen);
    await writeRejectLedger(supa, pool, input.kind, input.stockId, 'admission_exception', `exception:${(e as Error).message?.slice(0, 80)}`);
    return { granted: failOpen, reason: 'admission_exception' };
  }
}

/** 相容舊呼叫 — 現已於 admitFinmind 內自動寫入 reject ledger。 */
export async function logAdmissionRejection(
  supa: any,
  pool: FinmindPool,
  kind: string,
  stockId: string | null,
  reason: string,
): Promise<void> {
  await writeRejectLedger(supa, pool, kind, stockId, reason);
}
