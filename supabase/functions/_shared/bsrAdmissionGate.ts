/**
 * bsrAdmissionGate — Stage B v6 的 **唯一** admission gate client。
 *
 * 契約（對應 db/r1/c/SB/001_stage_b.sql 的三支 service_role wrapper）：
 *   public.bsr_admission_status()                 → 讀 gate 狀態
 *   public.bsr_block_and_terminalize_claims(...)  → 單一原子：關 gate + pairwise terminalize
 *   public.bsr_unblock_after_probe(...)           → 只有 server-side probe 成功才能開 gate
 *
 * 設計原則（不可退讓）：
 *   1. fail-closed：blocked / 不存在 / 形狀錯 / RPC error 一律 **不准** claim、不准打 provider。
 *      只有 `exists=true && blocked=false` 且 version 是整數，才算 open。
 *   2. terminal 只認 exact FinMind 方案／資格拒絕（走 bsrProviderState 這個唯一分類器）。
 *      429 / 5xx / timeout / network 是 retryable；判不出來就 unknown（有界重試），
 *      **絕不** 因為 unknown 而關 gate。
 *   3. evidence 全部 sanitize：key 走 denylist（與 DB 端 assert_sanitized 同一組正則），
 *      value 抽掉 URL / token / bearer / key=value 密鑰樣式並截斷。
 *   4. RPC 基礎設施失敗 → 有界 idempotent 重試；重試用盡回傳 failure，**不得假成功**。
 *
 * 這支是純邏輯 + 注入式 client，沒有任何模組層級的 DB/網路副作用，可在 unit test 直接驅動。
 */

import { classifyBsrError } from './bsrProviderState.ts';

/** DB wrapper 唯一允許的 terminal code（wrapper 會自己再驗一次）。 */
export const TERMINAL_CODE = 'finmind_admission_provider_plan_rejected';

/** 送進 RPC 的最大 claim 批量（DB 端硬上限 500）。 */
export const MAX_CLAIM_BATCH = 500;

// ------------------------------------------------------------------ client 型別

export interface RpcResult<T = unknown> {
  data: T;
  error: { message?: string; code?: string } | null;
}

export interface GateRpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcResult>;
}

// ------------------------------------------------------------------ admission status

export type AdmissionDecision =
  | 'open'
  | 'blocked'
  | 'missing'
  | 'malformed'
  | 'rpc_error';

export interface AdmissionStatus {
  /** 唯一可以放行的條件 */
  allowed: boolean;
  decision: AdmissionDecision;
  blocked: boolean;
  /** gate optimistic-concurrency version；不可信時為 null */
  version: number | null;
  /** unblock 用的一次性 nonce；open 或不可信時為 null */
  nonce: string | null;
  reason: string | null;
  terminalCode: string | null;
  blockedAt: string | null;
  /** 失敗原因（已 sanitize，可安全進 log / HTTP body） */
  detail: string | null;
}

function failClosed(
  decision: Exclude<AdmissionDecision, 'open'>,
  detail: string | null,
  extra: Partial<AdmissionStatus> = {},
): AdmissionStatus {
  return {
    allowed: false,
    decision,
    blocked: decision === 'blocked',
    version: null,
    nonce: null,
    reason: null,
    terminalCode: null,
    blockedAt: null,
    detail: detail ? sanitizeText(detail, 200) : null,
    ...extra,
  };
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * 把 `bsr_admission_status()` 的原始回傳正規化成 fail-closed 判定。
 * 匯出給 unit test 直接驅動所有分支（不需要 DB）。
 */
export function evaluateAdmission(res: RpcResult): AdmissionStatus {
  if (res.error) {
    const msg = res.error.message ?? res.error.code ?? 'unknown_rpc_error';
    return failClosed('rpc_error', `admission_status_rpc_error:${msg}`);
  }

  // PostgREST 對 RETURNS jsonb 會直接給物件；某些 driver 會包成單元素陣列。
  let raw: unknown = res.data;
  if (Array.isArray(raw)) raw = raw.length === 1 ? raw[0] : undefined;

  if (raw === null || raw === undefined) {
    return failClosed('malformed', 'admission_status_null');
  }
  if (typeof raw !== 'object') {
    return failClosed('malformed', `admission_status_not_object:${typeof raw}`);
  }

  const o = raw as Record<string, unknown>;

  if (o.exists !== true) {
    // gate row 不存在 → 無法確認狀態 → fail closed（不是「當作開著」）。
    return failClosed('missing', 'admission_gate_row_missing');
  }
  if (typeof o.blocked !== 'boolean') {
    return failClosed('malformed', `admission_blocked_not_boolean:${typeof o.blocked}`);
  }

  const version =
    typeof o.version === 'number' && Number.isInteger(o.version) ? o.version : null;
  if (version === null) {
    return failClosed('malformed', 'admission_version_not_integer');
  }

  if (o.blocked === true) {
    return {
      allowed: false,
      decision: 'blocked',
      blocked: true,
      version,
      nonce: asString(o.nonce),
      reason: asString(o.reason),
      terminalCode: asString(o.terminal_code),
      blockedAt: asString(o.blocked_at),
      detail: null,
    };
  }

  return {
    allowed: true,
    decision: 'open',
    blocked: false,
    version,
    nonce: null,
    reason: null,
    terminalCode: null,
    blockedAt: null,
    detail: null,
  };
}

/** 讀 gate 狀態；任何 throw 也轉成 fail-closed，呼叫端拿不到例外。 */
export async function fetchAdmissionStatus(client: GateRpcClient): Promise<AdmissionStatus> {
  try {
    const res = await client.rpc('bsr_admission_status');
    return evaluateAdmission(res as RpcResult);
  } catch (e) {
    return failClosed('rpc_error', `admission_status_threw:${(e as Error)?.message ?? 'unknown'}`);
  }
}

// ------------------------------------------------------------------ sanitize

const FORBIDDEN_KEY = /(token|url|authorization|cookie|api[_-]?key|secret|password|bearer|body|raw)/i;

/** 字串層級去識別：URL、bearer、key=value 密鑰、長 base64/hex 一律遮蔽，再截斷。 */
export function sanitizeText(input: unknown, maxLen = 200): string {
  let s = typeof input === 'string' ? input : String(input ?? '');
  s = s
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\bbearer\s+[A-Za-z0-9._\-]+/gi, 'bearer [redacted]')
    .replace(/\b(token|api[_-]?key|apikey|secret|password|authorization)\b\s*[:=]\s*"?[^\s",}]+"?/gi,
      (_m, k) => `${k}=[redacted]`)
    .replace(/\beyJ[A-Za-z0-9._-]{10,}/g, '[jwt]')
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, '[hex]');
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

/**
 * 遞迴 sanitize evidence：forbidden key **整個丟掉**（不是遮值），字串走 sanitizeText，
 * 深度與長度都有上限。輸出保證可通過 DB 端 private_bsr.assert_sanitized。
 */
export function sanitizeEvidence(input: unknown, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (depth > 4 || input === null || typeof input !== 'object' || Array.isArray(input)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (n >= 24) break;
    if (FORBIDDEN_KEY.test(k)) continue;
    n++;
    if (v === null || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = sanitizeText(v, 200);
    else if (Array.isArray(v)) {
      out[k] = v.slice(0, 10).map((x) =>
        typeof x === 'string' ? sanitizeText(x, 120)
          : (x !== null && typeof x === 'object' ? sanitizeEvidence(x, depth + 1) : x));
    } else if (typeof v === 'object') out[k] = sanitizeEvidence(v, depth + 1);
  }
  return out;
}

// ------------------------------------------------------------------ terminal 判定

export type ProviderOutcome = 'terminal' | 'retryable' | 'unknown' | 'none';

export interface ProviderClassification {
  outcome: ProviderOutcome;
  /** bsrProviderState 的白名單 code */
  code: string | null;
}

/**
 * 唯一的 provider 錯誤分類入口：直接沿用 `_shared/bsrProviderState.ts`，
 * 不在這裡另建平行規則（避免語意再度漂移）。
 * 只有 `provider_plan_rejected` 會回 terminal。
 */
export function classifyProviderError(
  lastErrorRaw: string | null,
  persistedErrorClass: string | null = null,
): ProviderClassification {
  const v = classifyBsrError(lastErrorRaw, persistedErrorClass);
  if (!v) return { outcome: 'none', code: null };
  if (v.state === 'terminal_provider_rejected' && v.code === 'provider_plan_rejected') {
    return { outcome: 'terminal', code: v.code };
  }
  if (v.state === 'retryable') return { outcome: 'retryable', code: v.code };
  return { outcome: 'unknown', code: v.code };
}

/** unknown 的有界重試：達到 cap 才停手，且**不**升級成 terminal、**不**關 gate。 */
export function unknownRetryAllowed(attempts: number, maxAttempts: number): boolean {
  const a = Number.isFinite(attempts) ? Number(attempts) : 0;
  const m = Number.isFinite(maxAttempts) && Number(maxAttempts) > 0 ? Number(maxAttempts) : 5;
  return a < m;
}

// ------------------------------------------------------------------ block + terminalize

export interface ClaimTuple {
  id: number;
  started_at: string | null;
  attempts: number | null;
}

export interface BlockResult {
  ok: boolean;
  transition: 'blocked' | 'already_blocked' | null;
  gateVersion: number | null;
  claimCount: number;
  updatedCount: number;
  lostLeaseCount: number;
  attemptsUsed: number;
  /** sanitize 過的失敗說明；ok=true 時為 null */
  error: string | null;
}

/** RPC 基礎設施錯誤（可重試） vs 契約錯誤（不可重試，重試只會再錯一次）。 */
function isRetryableRpcError(msg: string): boolean {
  const m = msg.toLowerCase();
  if (/terminal_code_not_allowed|claim_arrays|claim_batch_too_large|evidence_|gate_row_missing|gate_config_not_object|probe_/.test(m)) {
    return false;
  }
  return true;
}

export interface BlockOptions {
  runId: string;
  claims: ClaimTuple[];
  evidence: Record<string, unknown>;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * 單一原子 RPC：關 gate + 只 terminalize 本 run 真正持有 lease 的列。
 * 不直呼 private schema、不做全 pending UPDATE。
 * 基礎設施失敗 → 有界 idempotent 重試（wrapper 本身 idempotent：第二次會回 already_blocked）。
 */
export async function blockAndTerminalize(
  client: GateRpcClient,
  opts: BlockOptions,
): Promise<BlockResult> {
  const claims = (opts.claims ?? []).slice(0, MAX_CLAIM_BATCH);
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const evidence = sanitizeEvidence(opts.evidence ?? {});

  const args = {
    p_run_id: opts.runId,
    p_claim_ids: claims.map((c) => c.id),
    p_claim_started_at: claims.map((c) => c.started_at),
    p_claim_attempts: claims.map((c) => (c.attempts ?? 0)),
    p_terminal_code: TERMINAL_CODE,
    p_sanitized_evidence: evidence,
  };

  let lastErr = 'unknown';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: RpcResult;
    try {
      res = (await client.rpc('bsr_block_and_terminalize_claims', args)) as RpcResult;
    } catch (e) {
      lastErr = `rpc_threw:${(e as Error)?.message ?? 'unknown'}`;
      if (attempt < maxAttempts) { await sleep(attempt * 250); continue; }
      break;
    }

    if (res.error) {
      lastErr = res.error.message ?? res.error.code ?? 'rpc_error';
      if (isRetryableRpcError(lastErr) && attempt < maxAttempts) {
        await sleep(attempt * 250);
        continue;
      }
      break;
    }

    let raw: unknown = res.data;
    if (Array.isArray(raw)) raw = raw.length === 1 ? raw[0] : undefined;
    if (raw === null || typeof raw !== 'object') {
      lastErr = 'block_result_malformed';
      if (attempt < maxAttempts) { await sleep(attempt * 250); continue; }
      break;
    }
    const o = raw as Record<string, unknown>;
    const transition = o.transition === 'blocked' || o.transition === 'already_blocked'
      ? o.transition
      : null;
    if (transition === null) {
      lastErr = `block_transition_unexpected:${String(o.transition)}`;
      break;
    }
    const claimCount = Number(o.claim_count ?? claims.length);
    const updatedCount = Number(o.updated_count ?? 0);
    return {
      ok: true,
      transition,
      gateVersion: typeof o.gate_version === 'number' ? o.gate_version : null,
      claimCount,
      updatedCount,
      lostLeaseCount: Number(o.lost_lease_count ?? (claimCount - updatedCount)),
      attemptsUsed: attempt,
      error: null,
    };
  }

  // 重試用盡：明確失敗，caller 必須把 run 視為未關 gate（不得假成功）。
  return {
    ok: false,
    transition: null,
    gateVersion: null,
    claimCount: claims.length,
    updatedCount: 0,
    lostLeaseCount: claims.length,
    attemptsUsed: maxAttempts,
    error: sanitizeText(lastErr, 200),
  };
}

// ------------------------------------------------------------------ enqueue chunk 計數

export type ChunkStatus = 'inserted' | 'blocked' | 'unknown' | 'error';

export interface ChunkOutcome {
  status: ChunkStatus;
  candidateCount: number;
  insertedCount: number;
  /** 只有 status='blocked' 時才是數字；其餘一律 null（不猜） */
  blockedCount: number | null;
  error: string | null;
}

/**
 * 單一 chunk 的 admission 計數。**只有**「gate status 明確 blocked」且「insert error=null」
 * 才可以把 `candidate - inserted` 解讀成 blocked；其餘（duplicate、error、status unknown）
 * 一律 unknown/error，不用全表 delta 推論。
 */
export function classifyChunkOutcome(input: {
  admission: AdmissionStatus;
  candidateCount: number;
  insertedCount: number | null;
  error: { message?: string } | null;
}): ChunkOutcome {
  const candidateCount = Number(input.candidateCount ?? 0);
  if (input.error) {
    return {
      status: 'error',
      candidateCount,
      insertedCount: 0,
      blockedCount: null,
      error: sanitizeText(input.error.message ?? 'insert_error', 200),
    };
  }
  const insertedCount = Number(input.insertedCount ?? 0);
  const gap = candidateCount - insertedCount;

  if (input.admission.decision === 'blocked') {
    return {
      status: 'blocked',
      candidateCount,
      insertedCount,
      blockedCount: gap > 0 ? gap : 0,
      error: null,
    };
  }
  if (input.admission.decision === 'open') {
    // gate 開著：差額只可能是 duplicate/其他既有語意，不得記成 blocked。
    return {
      status: gap === 0 ? 'inserted' : 'unknown',
      candidateCount,
      insertedCount,
      blockedCount: null,
      error: null,
    };
  }
  // missing / malformed / rpc_error：狀態不可信 → unknown。
  return {
    status: 'unknown',
    candidateCount,
    insertedCount,
    blockedCount: null,
    error: input.admission.detail,
  };
}

/** 聚合多個 chunk 的結果（HTTP body / edge log 用）。 */
export function summarizeChunks(chunks: ChunkOutcome[]) {
  return {
    chunk_count: chunks.length,
    candidate_count: chunks.reduce((s, c) => s + c.candidateCount, 0),
    inserted_count: chunks.reduce((s, c) => s + c.insertedCount, 0),
    blocked_count: chunks.reduce((s, c) => s + (c.blockedCount ?? 0), 0),
    blocked_chunks: chunks.filter((c) => c.status === 'blocked').length,
    unknown_chunks: chunks.filter((c) => c.status === 'unknown').length,
    error_chunks: chunks.filter((c) => c.status === 'error').length,
  };
}
