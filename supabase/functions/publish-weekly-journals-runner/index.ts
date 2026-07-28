// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// publish-weekly-journals-runner
//
// 執行「本週週記批次」的一次嘗試，並在失敗/timeout 時，於 publish_batch_attempts
// 排入下一次重試（指數退避 1/2/4/8/16 分鐘，最多 max_attempts 次）。
//
// Request body:
//   { market: 'TW' | 'US',
//     attempt_no?: number,      // 預設 1
//     max_attempts?: number,    // 預設 5
//     attempt_id?: string,      // watchdog 重派時帶入既有 attempt row id
//     root_attempt_id?: string, // 重試鏈的根
//     trigger_source?: 'cron'|'watchdog'|'manual'
//   }

import { corsHeaders, jsonResponse, errorResponse, corsPreflight } from '../_shared/cors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const CALL_TIMEOUT_MS = 90_000; // publish-weekly-journals 通常 <30s；90s 足夠 + 安全邊界
const DEFAULT_MAX_ATTEMPTS = 5;

// 指數退避：attempt_no 為「剛失敗那次的 attempt_no」，回傳「下次」等待分鐘數
function backoffMinutes(justFailedAttemptNo: number): number {
  const base = Math.pow(2, Math.max(0, justFailedAttemptNo - 1)); // 1,2,4,8,16
  return Math.min(base, 30);
}

async function callPublishWithTimeout(market: 'TW' | 'US') {
  const url = `${SUPABASE_URL}/functions/v1/publish-weekly-journals`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`timeout after ${CALL_TIMEOUT_MS}ms`)), CALL_TIMEOUT_MS);
  const started = Date.now();
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: ANON_KEY,
      },
      body: JSON.stringify({ market }),
      signal: ctrl.signal,
    });
    const text = await resp.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    return {
      ok: resp.ok,
      status: resp.status,
      body: json,
      durationMs: Date.now() - started,
    };
  } catch (e: any) {
    return {
      ok: false,
      status: 0,
      body: { error: e?.message ?? String(e), aborted: !!ctrl.signal.aborted },
      durationMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsPreflight();
  if (req.method !== 'POST') return errorResponse('method_not_allowed', 405);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }

  const market = body?.market;
  if (market !== 'TW' && market !== 'US') {
    return errorResponse('invalid_market', 400, { message: 'market must be TW or US' });
  }
  const attemptNo = Math.max(1, Number(body?.attempt_no) || 1);
  const maxAttempts = Math.max(1, Number(body?.max_attempts) || DEFAULT_MAX_ATTEMPTS);
  const triggerSource = String(body?.trigger_source || 'cron');

  // 1) upsert 一筆 attempt row（若 watchdog 傳入 attempt_id，沿用該 row）
  let attemptId: string | null = body?.attempt_id ?? null;
  const rootId: string | null = body?.root_attempt_id ?? null;

  const nowIso = new Date().toISOString();
  if (attemptId) {
    const { error } = await admin.from('publish_batch_attempts')
      .update({ status: 'running', started_at: nowIso, next_retry_at: null })
      .eq('id', attemptId);
    if (error) return errorResponse('attempt_update_failed', 500, { detail: error.message });
  } else {
    const { data, error } = await admin.from('publish_batch_attempts')
      .insert({
        market,
        attempt_no: attemptNo,
        max_attempts: maxAttempts,
        status: 'running',
        scheduled_at: nowIso,
        started_at: nowIso,
        trigger_source: triggerSource,
        root_attempt_id: rootId,
      })
      .select('id').single();
    if (error) return errorResponse('attempt_insert_failed', 500, { detail: error.message });
    attemptId = data.id as string;
    // 若這是重試鏈的第一筆，把 root_attempt_id 指向自身，便於後續查詢
    if (!rootId) {
      await admin.from('publish_batch_attempts').update({ root_attempt_id: attemptId }).eq('id', attemptId);
    }
  }

  const result = await callPublishWithTimeout(market);

  const runId: string | null =
    (typeof result.body === 'object' && result.body && typeof (result.body as any).runId === 'string')
      ? (result.body as any).runId
      : null;

  // 判斷成功/失敗
  //   成功條件：HTTP 2xx 且沒有 body.error
  const succeeded = result.ok && !((result.body as any)?.error);
  const finishedAt = new Date().toISOString();

  if (succeeded) {
    await admin.from('publish_batch_attempts').update({
      status: 'succeeded',
      finished_at: finishedAt,
      run_id: runId,
      response: result.body,
      error_message: null,
    }).eq('id', attemptId);
    return jsonResponse({
      ok: true, attempt_id: attemptId, attempt_no: attemptNo, market,
      duration_ms: result.durationMs, run_id: runId, response: result.body,
    });
  }

  // 失敗 → 更新該 attempt，並排入下一次
  const errMsg = (() => {
    try {
      if (typeof result.body === 'string') return result.body;
      return (result.body as any)?.error || (result.body as any)?.message
        || `HTTP ${result.status}` || 'unknown error';
    } catch { return `HTTP ${result.status}`; }
  })();

  const nextAttemptNo = attemptNo + 1;
  const willRetry = nextAttemptNo <= maxAttempts;
  const finalStatus = willRetry ? 'failed' : 'exhausted';

  await admin.from('publish_batch_attempts').update({
    status: finalStatus,
    finished_at: finishedAt,
    run_id: runId,
    response: result.body,
    error_message: String(errMsg).slice(0, 2000),
  }).eq('id', attemptId);

  let nextAttemptId: string | null = null;
  if (willRetry) {
    const delayMin = backoffMinutes(attemptNo);
    const nextAt = new Date(Date.now() + delayMin * 60_000).toISOString();
    const { data: nextRow, error: nextErr } = await admin.from('publish_batch_attempts')
      .insert({
        market,
        attempt_no: nextAttemptNo,
        max_attempts: maxAttempts,
        status: 'pending_retry',
        scheduled_at: new Date().toISOString(),
        next_retry_at: nextAt,
        parent_attempt_id: attemptId,
        root_attempt_id: rootId || attemptId,
        trigger_source: 'watchdog',
      })
      .select('id').single();
    if (nextErr) {
      console.error('[runner] schedule next retry failed', nextErr.message);
    } else {
      nextAttemptId = nextRow.id as string;
    }
  }

  return jsonResponse({
    ok: false,
    attempt_id: attemptId,
    attempt_no: attemptNo,
    market,
    duration_ms: result.durationMs,
    run_id: runId,
    error: errMsg,
    will_retry: willRetry,
    next_attempt_id: nextAttemptId,
    next_attempt_no: willRetry ? nextAttemptNo : null,
  }, { status: 200 });
});
