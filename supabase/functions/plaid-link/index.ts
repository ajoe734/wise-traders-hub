// plaid-link: Firstrade (via Plaid Investments) read-only holdings for analysts.
// AUTH: user actions → requireExpertOwnerOrAdmin; cron actions → requireCronKey.
// Access tokens live only in plaid_access_tokens (service_role only) and never leave this function.
import { requireExpertOwnerOrAdmin, authErrorResponse } from '../_shared/adminGuard.ts';
import { requireCronKey } from '../_shared/authGuard.ts';
import { serviceClient } from '../_shared/supabaseClients.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { buildNotificationRow } from '../_shared/routes.ts';
import { plaidEnv, plaidBaseUrl, revokeDeadline, revokeUrgency, mapHoldings, attemptRevokeWith, isAllowedInstitution, FIRSTRADE_INSTITUTION_ID } from '../_shared/plaidCore.ts';

const ENV = plaidEnv(Deno.env.get('PLAID_ENV'));
const BASE = plaidBaseUrl(ENV);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_REDIRECTS = new Set([
  'https://legendflow.tw/expert/plaid-callback',
  'https://id-preview--0f5bdae6-cb07-4e2a-88dc-334c90cb5b02.lovable.app/expert/plaid-callback',
]);
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

class PlaidError extends Error { constructor(public code: string, public type: string) { super(code); } }

async function plaid(path: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: Deno.env.get('PLAID_CLIENT_ID'), secret: Deno.env.get('PLAID_SECRET'), ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new PlaidError(data?.error_code || `HTTP_${res.status}`, data?.error_type || 'UNKNOWN');
  return data;
}

const db = () => serviceClient();

async function activeConnection(expertId: string) {
  const { data } = await db().from('plaid_connections').select('*').eq('expert_id', expertId).eq('status', 'active').maybeSingle();
  return data;
}

async function notifyExpert(expertId: string, title: string, body: string) {
  const { data: ex } = await db().from('experts').select('user_id, slug').eq('id', expertId).maybeSingle();
  if (!ex?.user_id) return;
  await db().from('notifications').insert(buildNotificationRow({
    userId: ex.user_id, title, body, type: 'warning' as any, link: `/admin/${ex.slug}/brokerage`,
  }));
}

async function exchange(expertId: string, userId: string | null, publicToken: string, institution: { id?: string; name?: string }) {
  if (await activeConnection(expertId)) return { error: 'already_connected' };
  const ex = await plaid('/item/public_token/exchange', { public_token: publicToken });
  // Never trust the client-reported institution: ask Plaid which institution the item belongs to.
  const item = await plaid('/item/get', { access_token: ex.access_token }).catch(() => null);
  const instId = item?.item?.institution_id ?? null;
  if (!isAllowedInstitution(instId)) {
    await plaid('/item/remove', { access_token: ex.access_token }).catch(() => {});
    return { error: 'institution_not_allowed', institution_id: instId };
  }
  institution = { id: instId, name: institution.name || 'Firstrade' };
  const { data: conn, error } = await db().from('plaid_connections').insert({
    expert_id: expertId, environment: ENV, item_id: ex.item_id,
    institution_id: institution.id ?? null, institution_name: institution.name ?? null, created_by: userId,
  }).select('id').single();
  if (error) {
    // could not record the connection → revoke immediately so no orphan grant remains at Plaid
    await plaid('/item/remove', { access_token: ex.access_token }).catch(() => {});
    throw error;
  }
  await db().from('plaid_access_tokens').insert({ connection_id: conn.id, access_token: ex.access_token });
  return { connection_id: conn.id };
}

async function syncConnection(conn: any, trigger: string) {
  const { data: run } = await db().from('plaid_sync_runs').insert({ connection_id: conn.id, expert_id: conn.expert_id, trigger }).select('id').single();
  const finish = (status: string, extra: Record<string, unknown> = {}) =>
    db().from('plaid_sync_runs').update({ status, finished_at: new Date().toISOString(), ...extra }).eq('id', run!.id);
  try {
    if (conn.sync_blocked || conn.status !== 'active') { await finish('blocked'); return { status: 'blocked' }; }
    const { data: tok } = await db().from('plaid_access_tokens').select('access_token').eq('connection_id', conn.id).maybeSingle();
    if (!tok) throw new PlaidError('TOKEN_MISSING', 'LOCAL');
    const resp = await plaid('/investments/holdings/get', { access_token: tok.access_token });
    const rows = mapHoldings(resp);
    // Re-check state at write time inside a row lock (handles disconnect during the fetch).
    const { data: n, error } = await db().rpc('plaid_replace_drafts', { _connection_id: conn.id, _run_id: run!.id, _rows: rows });
    if (error) {
      if (String(error.message).includes('plaid_sync_blocked')) { await finish('blocked'); return { status: 'blocked' }; }
      throw error;
    }
    await finish('ok', { holdings_count: n });
    return { status: 'ok', holdings_count: n };
  } catch (e) {
    const code = e instanceof PlaidError ? e.code : 'INTERNAL';
    await finish('failed', { error_code: code });
    await db().from('plaid_connections').update({ last_sync_status: 'failed', last_error: code, updated_at: new Date().toISOString() })
      .eq('id', conn.id).eq('status', 'active');
    await notifyExpert(conn.expert_id, 'Firstrade 持倉同步失敗',
      code === 'ITEM_LOGIN_REQUIRED' ? '券商要求重新驗證，請到「券商持倉」重新連結。' : `同步未完成（${code}），系統會在下次排程重試。`);
    return { status: 'failed', error_code: code };
  }
}

function attemptRevoke(conn: any) {
  return attemptRevokeWith({
    getToken: async (id) => (await db().from('plaid_access_tokens').select('access_token').eq('connection_id', id).maybeSingle()).data?.access_token ?? null,
    removeItem: async (t) => { await plaid('/item/remove', { access_token: t }); },
    deleteTokenAndDrafts: async (id) => {
      await db().from('plaid_access_tokens').delete().eq('connection_id', id);
      await db().from('plaid_holding_drafts').delete().eq('connection_id', id);
    },
    countTokens: async (id) => (await db().from('plaid_access_tokens').select('connection_id', { count: 'exact', head: true }).eq('connection_id', id)).count ?? 0,
    markPurged: async (id, revokedAt, now) => {
      await db().from('plaid_connections').update({ status: 'purged', revoked_at: revokedAt, purged_at: now, last_error: null, updated_at: now }).eq('id', id);
    },
    markRetry: async (id, attempts, errCode) => {
      await db().from('plaid_connections').update({ revoke_attempts: attempts, last_error: errCode, updated_at: new Date().toISOString() }).eq('id', id);
    },
    alert: async (urgency, id, deadline, errCode, attempts) => {
      await db().from('system_alerts').insert({
        kind: 'plaid_revoke_' + urgency, level: urgency === 'overdue' ? 'critical' : 'warning',
        title: urgency === 'overdue' ? 'Plaid 解除連結已逾 24 小時期限' : 'Plaid 解除連結接近 24 小時期限',
        message: `connection ${id} 撤銷失敗（${errCode}），第 ${attempts} 次`,
        detail: { connection_id: id, deadline, error_code: errCode },
      });
    },
  }, conn, new Date());
}

async function disconnect(expertId: string) {
  const now = new Date();
  const { data: rows } = await db().from('plaid_connections').select('*').eq('expert_id', expertId).in('status', ['active', 'disconnect_requested']);
  const results = [];
  for (const conn of rows || []) {
    const deadline = revokeDeadline(conn.revoke_deadline_at, now);
    await db().from('plaid_connections').update({
      sync_blocked: true, status: 'disconnect_requested',
      disconnect_requested_at: conn.disconnect_requested_at ?? now.toISOString(), revoke_deadline_at: deadline, updated_at: now.toISOString(),
    }).eq('id', conn.id);
    await db().from('plaid_holding_drafts').delete().eq('connection_id', conn.id);
    results.push(await attemptRevoke({ ...conn, revoke_deadline_at: deadline, sync_blocked: true, status: 'disconnect_requested' }));
  }
  return { results };
}

async function retryRevokes() {
  const { data: pending } = await db().from('plaid_connections').select('*').eq('status', 'disconnect_requested');
  const results = [];
  for (const c of pending || []) results.push(await attemptRevoke(c));
  // Re-apply completed disconnections (e.g. after a backup restore): purged connections must hold no token or drafts.
  const { data: purged } = await db().from('plaid_connections').select('id').in('status', ['purged']);
  const ids = (purged || []).map((r: any) => r.id);
  let reapplied = 0;
  if (ids.length) {
    const { data: t } = await db().from('plaid_access_tokens').delete().in('connection_id', ids).select('connection_id');
    const { data: d } = await db().from('plaid_holding_drafts').delete().in('connection_id', ids).select('id');
    reapplied = (t?.length || 0) + (d?.length || 0);
  }
  return { retried: results.length, results, reapplied };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || '');
  if (!Deno.env.get('PLAID_CLIENT_ID') || !Deno.env.get('PLAID_SECRET')) return json({ error: 'plaid_not_configured' }, 503);

  try {
    if (action === 'retry_revokes' || action === 'sync_all') {
      requireCronKey(req);
      if (action === 'retry_revokes') return json(await retryRevokes());
      const { data: conns } = await db().from('plaid_connections').select('*').eq('status', 'active').eq('sync_blocked', false);
      const results = [];
      for (const c of conns || []) results.push({ id: c.id, ...(await syncConnection(c, 'cron')) });
      return json({ env: ENV, results });
    }

    const expertId = String(body?.expert_id || '');
    if (!UUID.test(expertId)) return json({ error: 'invalid_expert_id' }, 400);
    const who = await requireExpertOwnerOrAdmin(req, expertId);

    switch (action) {
      case 'status': {
        const { data } = await db().from('plaid_connections').select('id, status, institution_name, last_sync_at, last_sync_status, last_error, revoke_deadline_at, purged_at, environment')
          .eq('expert_id', expertId).order('created_at', { ascending: false }).limit(5);
        return json({ env: ENV, connections: data || [] });
      }
      case 'create_link_token': {
        const r = await plaid('/link/token/create', {
          client_name: 'legendflow', language: 'en', country_codes: ['US'], products: ['investments'],
          user: { client_user_id: who.userId },
          ...(ALLOWED_REDIRECTS.has(String(body?.redirect_uri || '')) ? { redirect_uri: body.redirect_uri } : {}),
        });
        return json({ link_token: r.link_token, expiration: r.expiration, env: ENV });
      }
      case 'exchange': {
        const pt = String(body?.public_token || '');
        if (!pt.startsWith('public-')) return json({ error: 'invalid_public_token' }, 400);
        const out = await exchange(expertId, who.userId, pt, { id: body?.institution?.institution_id, name: body?.institution?.name });
        if ('error' in out) return json(out, out.error === 'institution_not_allowed' ? 422 : 409);
        const conn = await activeConnection(expertId);
        const sync = await syncConnection(conn, 'initial');
        return json({ ...out, sync });
      }
      case 'sandbox_connect': {
        if (ENV !== 'sandbox') return json({ error: 'sandbox_only' }, 403);
        const inst = String(body?.institution_id || FIRSTRADE_INSTITUTION_ID);
        const pt = await plaid('/sandbox/public_token/create', { institution_id: inst, initial_products: ['investments'] });
        const out = await exchange(expertId, who.userId, pt.public_token, { id: inst, name: 'Firstrade' });
        if ('error' in out) return json(out, out.error === 'institution_not_allowed' ? 422 : 409);
        const conn = await activeConnection(expertId);
        return json({ ...out, sync: await syncConnection(conn, 'initial') });
      }
      case 'sandbox_reset_login': {
        // Sandbox-only: force ITEM_LOGIN_REQUIRED to exercise the failure + notification path.
        if (ENV !== 'sandbox') return json({ error: 'sandbox_only' }, 403);
        const conn = await activeConnection(expertId);
        if (!conn) return json({ error: 'not_connected' }, 404);
        const { data: tok } = await db().from('plaid_access_tokens').select('access_token').eq('connection_id', conn.id).maybeSingle();
        await plaid('/sandbox/item/reset_login', { access_token: tok!.access_token });
        return json({ reset: true });
      }
      case 'sync': {
        const conn = await activeConnection(expertId);
        if (!conn) return json({ error: 'not_connected' }, 404);
        return json(await syncConnection(conn, 'manual'));
      }
      case 'confirm_drafts': {
        const conn = await activeConnection(expertId);
        if (!conn || conn.sync_blocked) return json({ error: 'not_connected' }, 404);
        const { data } = await db().from('plaid_holding_drafts')
          .update({ review_status: 'confirmed', confirmed_at: new Date().toISOString(), confirmed_by: who.userId })
          .eq('connection_id', conn.id).eq('review_status', 'draft').select('id');
        return json({ confirmed: data?.length || 0 });
      }
      case 'disconnect':
        return json(await disconnect(expertId));
      default:
        return json({ error: 'unknown_action' }, 400);
    }
  } catch (e) {
    if (e instanceof PlaidError) { console.error('plaid-link plaid error', e.code); return json({ error: 'plaid_error', code: e.code }, 502); }
    return authErrorResponse(e, req);
  }
});
