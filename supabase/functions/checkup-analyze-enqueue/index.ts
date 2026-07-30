// AUTH: user  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// 收盤分析背景化入口：建立 job + fire-and-forget 觸發 worker
// 前端送 { prompts: { blind, main, brain }, holdings_snapshot } —— 前端負責組 prompt
// 回傳 { job_id }，使用者可立即關閉頁面。
import { serviceClient } from '../_shared/supabaseClients.ts';
import { corsPreflight, jsonResponse } from '../_shared/cors.ts';
import { requireCaller, AuthError } from '../_shared/authGuard.ts';
import { withLogging } from '../_shared/edgeLogger.ts';

const handler = withLogging('checkup-analyze-enqueue', async (req, log) => {
  // AUTH: user (Phase M-2 runtime enforcement)
  if (req.method !== 'OPTIONS') {
    try { await requireCaller(req); }
    catch (e) {
      if (e instanceof AuthError) {
        return new Response(JSON.stringify({ error: e.message, code: e.code }), {
          status: e.status,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      throw e;
    }
  }

  if (req.method === 'OPTIONS') return corsPreflight();
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, { status: 405 });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return jsonResponse({ error: 'AUTH_REQUIRED' }, { status: 401 });

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: SERVICE_ROLE_KEY },
  });
  if (!userRes.ok) return jsonResponse({ error: 'AUTH_INVALID' }, { status: 401 });
  const user = await userRes.json();
  const userId = user?.id;
  if (!userId) return jsonResponse({ error: 'AUTH_INVALID' }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const prompts = body?.prompts || {};
  const holdings = Array.isArray(body?.holdings_snapshot) ? body.holdings_snapshot : [];
  if (!prompts?.main) {
    return jsonResponse({ error: 'prompts.main is required' }, { status: 400 });
  }

  const admin = serviceClient();

  // 去重：當日已有 queued/running job 就回傳該 job_id
  const todayTw = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  todayTw.setHours(0, 0, 0, 0);
  const startIso = new Date(todayTw.getTime() - 8 * 3600_000).toISOString();
  const { data: existing } = await admin
    .from('checkup_analysis_jobs')
    .select('id, status')
    .eq('user_id', userId)
    .in('status', ['queued', 'running'])
    .gte('started_at', startIso)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    log.info('reuse_existing_job', { jobId: existing.id });
    return jsonResponse({ ok: true, job_id: existing.id, reused: true });
  }

  const { data: job, error } = await admin
    .from('checkup_analysis_jobs')
    .insert({
      user_id: userId,
      status: 'queued',
      holdings_snapshot: holdings,
      prompts_payload: prompts,
      started_at: new Date().toISOString(),
    })
    .select('id')
    .maybeSingle();

  if (error || !job?.id) {
    log.error('enqueue_failed', { err: error?.message });
    return jsonResponse({ error: 'ENQUEUE_FAILED', detail: error?.message }, { status: 500 });
  }

  // Fire-and-forget worker（不 await，立即回傳）
  fetch(`${SUPABASE_URL}/functions/v1/checkup-analyze-worker`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    body: JSON.stringify({ job_id: job.id }),
  }).catch((e) => log.warn('worker_invoke_failed', { err: String(e).slice(0, 200) }));

  return jsonResponse({ ok: true, job_id: job.id });
});

Deno.serve(handler);
