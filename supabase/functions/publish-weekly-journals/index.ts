// AUTH: cron  (M-4 reclassified: hybrid cron-or-user; scheduler uses X-Cron-Key, mentor force-publish uses bearer)
//
// 這支函式只負責：認證 → 解析 scope → 建 port/logger → 交給 pipeline.ts → 回應。
// 所有發布邏輯都在 pipeline.ts（可用 fake port 單元測試）。
import { corsHeaders } from '../_shared/cors.ts';
import { isCompanyAdmin } from '../_shared/adminGuard.ts';
import { serviceClient } from '../_shared/supabaseClients.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
import { requireCronKey, requireCaller, AuthError } from '../_shared/authGuard.ts';
import { createSupabasePublishPort } from './supabasePort.ts';
import { resolveMarketScope, runPublishPipeline } from './pipeline.ts';

Deno.serve(withLogging('publish-weekly-journals', async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // M-4: cron-or-user hybrid guard. Accept either a valid X-Cron-Key
  // (scheduler / market batch) OR a valid user bearer (mentor force-publish,
  // deeper-checked in authorize_force). Reject with 403 when neither is valid.
  let cronOk = false;
  try { requireCronKey(req); cronOk = true; } catch { /* try user path */ }
  if (!cronOk) {
    try { await requireCaller(req); }
    catch (e) {
      const err = e instanceof AuthError
        ? e
        : new AuthError(403, 'FORBIDDEN', 'requires X-Cron-Key or user bearer');
      const status = err.status === 401 ? 403 : err.status;
      return new Response(JSON.stringify({ error: err.message, code: err.code }), {
        status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  const runId = crypto.randomUUID().slice(0, 8);
  const t0 = Date.now();
  const fn = 'publish-weekly-journals';
  const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const supabaseAdmin = supabaseUrl && serviceRoleKey ? serviceClient() : null;

  const logBuffer: any[] = [];
  const flushLogs = async () => {
    if (!supabaseAdmin || logBuffer.length === 0) return;
    const rows = logBuffer.splice(0, logBuffer.length);
    try {
      await supabaseAdmin.from('function_run_logs').insert(rows);
    } catch (e) {
      console.error('[function_run_logs flush failed]', (e as any)?.message);
    }
  };

  let stage = 'init';
  const emit = (
    level: 'info' | 'warn' | 'error',
    msg: string,
    ctx: Record<string, unknown> = {},
  ) => {
    const stageVal = (ctx.stage ?? stage) as string | undefined;
    const expertId = (ctx.expertId ?? null) as string | null;
    const signalId = (ctx.signalId ?? null) as string | null;
    const payload = { ts: new Date().toISOString(), level, fn, runId, stage: stageVal, expertId, signalId, msg, ...ctx };
    const human = `[${fn}][${runId}]${stageVal ? `[stage=${stageVal}]` : ''}${
      expertId ? `[expert=${expertId}]` : ''
    }${signalId ? `[signal=${signalId}]` : ''} ${msg}`;
    const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    out(human);
    out(JSON.stringify(payload));
    logBuffer.push({ fn, run_id: runId, level, stage: stageVal ?? null, msg, expert_id: expertId, signal_id: signalId, payload });
  };
  const log = (msg: string, ctx: Record<string, unknown> = {}) => emit('info', msg, { stage, ...ctx });
  const logErr = (stageName: string, err: unknown, extra: Record<string, unknown> = {}) => {
    const e = err as any;
    emit('error', `FAILED: ${e?.message ?? String(err)}`, {
      stage: stageName,
      err: { name: e?.name, message: e?.message ?? String(err), code: e?.code, details: e?.details, hint: e?.hint, status: e?.status, stack: e?.stack },
      ...extra,
    });
  };

  try {
    if (!supabaseUrl || !serviceRoleKey || !supabaseAdmin) {
      const missing = [!supabaseUrl && 'SUPABASE_URL', !serviceRoleKey && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean);
      emit('error', 'Missing required env', { stage: 'init', missing });
      await flushLogs();
      return json({ error: 'Missing required env', missing, runId }, 500);
    }
    log('Function start');

    // body 形態：
    //   {}                                   → cron 完整批次
    //   { market: 'TW' | 'US' }              → 只發布指定市場老師的 pending
    //   { expert_id: uuid, force: true }     → 老師手動提前發布本人本週 pending
    stage = 'parse_body';
    let body: { expert_id?: string; market?: 'TW' | 'US'; force?: boolean } = {};
    if (req.method === 'POST') {
      try {
        const raw = await req.text();
        if (raw.trim()) body = JSON.parse(raw);
      } catch { body = {}; }
    }

    const port = createSupabasePublishPort(supabaseAdmin);

    let filterExpertIds: string[] | null = null;
    if (body.force && body.expert_id) {
      stage = 'authorize_force';
      const { data: authUser } = await supabaseAdmin.auth.getUser(
        (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''),
      );
      const callerId = authUser?.user?.id || null;
      if (!callerId) {
        await flushLogs();
        return json({ error: 'unauthorized', runId }, 401);
      }
      const expertRow = await port.getExpert(body.expert_id);
      const isOwner = expertRow?.user_id === callerId;
      const isAdmin = await isCompanyAdmin(callerId);
      if (!isOwner && !isAdmin) {
        await flushLogs();
        return json({ error: 'forbidden', runId }, 403);
      }
      filterExpertIds = [body.expert_id];
      log('Force publish authorized', { expertId: body.expert_id, isOwner, isAdmin });
    } else if (body.market === 'TW' || body.market === 'US') {
      stage = 'filter_by_market';
      filterExpertIds = await resolveMarketScope(port, body.market);
      log(`Market batch: ${body.market} experts=${filterExpertIds.length}`);
      if (filterExpertIds.length === 0) {
        await flushLogs();
        return json({ published: 0, pushed: 0, runId, market: body.market });
      }
    }

    stage = 'pipeline';
    const result = await runPublishPipeline(port, { filterExpertIds, force: body.force === true }, emit);

    const elapsedMs = Date.now() - t0;
    log(`Done. published=${result.published} failed=${result.failed} pushed=${result.pushed} pushFail=${result.pushFail} elapsedMs=${elapsedMs}`);
    await flushLogs();
    return json({ runId, ...result, elapsedMs });
  } catch (err) {
    logErr(stage, err);
    await flushLogs();
    const e = err as any;
    return json({ error: e?.message ?? 'Internal server error', stage, runId, name: e?.name, code: e?.code }, 500);
  }
}));
