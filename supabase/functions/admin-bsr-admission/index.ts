// AUTH: company_admin (requireCompanyAdmin — JWT via auth.getUser + DB has_role)
// admin-bsr-admission — Stage B v6 §4
//
// 兩個動作：
//   POST { action: 'status' }  → 讀 gate 狀態（唯讀）
//   POST { action: 'probe' }   → **伺服器自己**打一次 FinMind 最小 probe；
//                                 只有 probe 真的成功，才用 expected_version + nonce +
//                                 verified actor 呼叫 bsr_unblock_after_probe。
//
// caller 不得提供 success / evidence / provider response：body schema 只收
// stock_id 與 trade_date（都會被白名單驗證），其餘欄位一律忽略。
// stale version / 重放（nonce 不符）/ 非 admin / 429 / 5xx / terminal 一律不能 unblock。

import { corsHeaders } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/supabaseClients.ts';
import { authErrorResponse, requireCompanyAdmin } from '../_shared/adminGuard.ts';
import {
  fetchAdmissionStatus,
  sanitizeText,
  type GateRpcClient,
} from '../_shared/bsrAdmissionGate.ts';
import { runProviderProbe } from '../_shared/bsrAdmissionProbe.ts';

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const STOCK_ID_RE = /^[1-9][0-9]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let actor: string;
  try {
    actor = await requireCompanyAdmin(req);
  } catch (err) {
    return authErrorResponse(err, req);
  }

  let body: Record<string, unknown> = {};
  try { body = (await req.json()) as Record<string, unknown>; } catch { body = {}; }

  const action = String(body?.action ?? 'status');
  const supa = serviceClient() as unknown as GateRpcClient;

  if (action === 'status') {
    const s = await fetchAdmissionStatus(supa);
    return json({
      ok: true,
      action,
      admission: {
        decision: s.decision,
        blocked: s.blocked,
        reason: s.reason ?? s.detail,
        terminal_code: s.terminalCode,
        blocked_at: s.blockedAt,
        gate_version: s.version,
        // nonce 只給 admin 讀，用於下一步 probe 的 replay 防護
        nonce_present: s.nonce !== null,
      },
    });
  }

  if (action !== 'probe') {
    return json({ ok: false, error: 'unsupported_action' }, 400);
  }

  const stockId = String(body?.stock_id ?? '2330').trim();
  const tradeDate = String(body?.trade_date ?? '').trim();
  if (!STOCK_ID_RE.test(stockId)) {
    return json({ ok: false, error: 'invalid_stock_id' }, 400);
  }
  if (tradeDate && !DATE_RE.test(tradeDate)) {
    return json({ ok: false, error: 'invalid_trade_date' }, 400);
  }
  const effectiveDate = tradeDate || new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  // 1) 先讀 gate 狀態，拿 expected_version + nonce（replay 防護的兩個關鍵）
  const before = await fetchAdmissionStatus(supa);
  if (before.decision === 'rpc_error' || before.decision === 'malformed' || before.decision === 'missing') {
    return json({
      ok: false, action, error: 'admission_status_unavailable',
      decision: before.decision, detail: before.detail,
    }, 503);
  }
  if (!before.blocked) {
    return json({ ok: true, action, transition: 'already_open', gate_version: before.version });
  }

  // 2) 伺服器自己 probe。caller 完全無法影響結果。
  const allowLocal = Deno.env.get('BSR_PROBE_ALLOW_LOCAL') === '1';
  const probe = await runProviderProbe({
    stockId,
    tradeDate: effectiveDate,
    token: Deno.env.get('FINMIND_TOKEN') ?? '',
    baseUrl: allowLocal ? (Deno.env.get('FINMIND_PROBE_BASE_URL') ?? undefined) : undefined,
    allowLocal,
  });

  if (!probe.success) {
    return json({
      ok: true,
      action,
      unblocked: false,
      probe_outcome: probe.outcome,
      http_status: probe.httpStatus,
      error: probe.error,
      gate_version: before.version,
      evidence: probe.evidence,
    });
  }

  // 3) probe 成功才 unblock；expected_version + nonce 讓 stale/重放自然失敗。
  const { data, error } = await (supa as unknown as {
    rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
  }).rpc('bsr_unblock_after_probe', {
    p_expected_version: before.version,
    p_nonce: before.nonce,
    p_sanitized_evidence: probe.evidence,
    p_verified_actor: actor,
  });

  if (error) {
    return json({
      ok: false, action, unblocked: false,
      error: sanitizeText(error.message ?? 'unblock_rpc_error', 200),
      gate_version: before.version,
    }, 500);
  }

  let raw: unknown = data;
  if (Array.isArray(raw)) raw = raw.length === 1 ? raw[0] : undefined;
  const o = (raw ?? {}) as Record<string, unknown>;
  const transition = String(o.transition ?? 'unknown');

  return json({
    ok: true,
    action,
    unblocked: transition === 'unblocked',
    transition,
    gate_version: o.gate_version ?? null,
    probe_outcome: probe.outcome,
    evidence: probe.evidence,
  });
});
