// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// publish-weekly-journals-watchdog
//
// 每分鐘 pg_cron 呼叫一次；掃描 publish_batch_attempts 中 status='pending_retry'
// 且 next_retry_at <= now() 的 row，逐一觸發 runner。
//
// 用 UPDATE ... RETURNING 搶佔（樂觀鎖）避免同一 attempt 被觸發兩次。

import { serviceClient } from '../_shared/supabaseClients.ts';
import { corsHeaders, jsonResponse, corsPreflight } from '../_shared/cors.ts';
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const CRON_SHARED_SECRET = Deno.env.get('CRON_SHARED_SECRET') ?? '';

const MAX_DISPATCH_PER_TICK = 10;

Deno.serve(async (req) => {
  // AUTH: cron (Phase M-2 runtime enforcement)
  if (req.method !== 'OPTIONS') {
    try { requireCronKey(req); }
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

  const admin = serviceClient();
  const nowIso = new Date().toISOString();

  // runner dispatch 若在 gateway 層失敗，舊版 watchdog 會把 row 永久留在 running。
  // 每次 tick 先回收超過 runner timeout 安全邊界的卡死工作。
  const staleBefore = new Date(Date.now() - 3 * 60_000).toISOString();
  await admin.from('publish_batch_attempts')
    .update({
      status: 'pending_retry',
      next_retry_at: nowIso,
      error_message: 'WATCHDOG_RECOVERED_STALE_RUNNING',
    })
    .eq('status', 'running')
    .lt('started_at', staleBefore);

  // 1) 找到期的 pending_retry
  const { data: due, error } = await admin
    .from('publish_batch_attempts')
    .select('id, market, attempt_no, max_attempts, root_attempt_id, parent_attempt_id')
    .eq('status', 'pending_retry')
    .lte('next_retry_at', nowIso)
    .order('next_retry_at', { ascending: true })
    .limit(MAX_DISPATCH_PER_TICK);

  if (error) {
    console.error('[watchdog] query failed', error.message);
    return jsonResponse({ ok: false, error: error.message }, { status: 500 });
  }

  const dispatched: any[] = [];
  for (const row of due || []) {
    // 樂觀鎖：從 pending_retry -> running；被別人先搶走就跳過
    const { data: claimed, error: claimErr } = await admin
      .from('publish_batch_attempts')
      .update({ status: 'running', started_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('status', 'pending_retry')
      .select('id').maybeSingle();
    if (claimErr || !claimed) continue;

    // 非同步觸發 runner；不等回應（runner 自己會 update）
    const runnerUrl = `${SUPABASE_URL}/functions/v1/publish-weekly-journals-runner`;
    try {
      // fire-and-forget（等 fetch 送出即可，不等 body）
      fetch(runnerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: ANON_KEY,
          'X-Cron-Key': CRON_SHARED_SECRET,
        },
        body: JSON.stringify({
          market: row.market,
          attempt_no: row.attempt_no,
          max_attempts: row.max_attempts,
          attempt_id: row.id,
          root_attempt_id: row.root_attempt_id || row.id,
          trigger_source: 'watchdog',
        }),
      }).catch((e) => console.error('[watchdog] runner dispatch failed', row.id, e?.message));
      dispatched.push({ attempt_id: row.id, market: row.market, attempt_no: row.attempt_no });
    } catch (e: any) {
      console.error('[watchdog] dispatch exception', e?.message);
    }
  }

  return jsonResponse({ ok: true, at: nowIso, dispatched });
});
