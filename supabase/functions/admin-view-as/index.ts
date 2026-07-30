// AUTH: user  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// admin-view-as: issue + resolve short-lived view-as tokens for company admins.
// - action=issue:   admin requests a token for target_user_id (15 min TTL, one-shot)
// - action=resolve: viewer page exchanges token → { admin_id, target_user_id, target_email }
//                   token is marked consumed_at and revoked after first resolve.

import { serviceClient, userClient } from '../_shared/supabaseClients.ts';
import { requireCompanyAdmin, authErrorResponse } from '../_shared/adminGuard.ts';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TTL_MS = 15 * 60 * 1000;

function rand(len = 32) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return json({ error: 'unauthorized' }, 401);
    }
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const uc = userClient(req);
    const admin = serviceClient();

    const token = authHeader.replace('Bearer ', '');
    const { data: claims, error: claimsErr } = await uc.auth.getClaims(token);
    if (claimsErr || !claims?.claims?.sub) return json({ error: 'unauthorized' }, 401);
    const callerId = claims.claims.sub as string;

    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    if (action === 'issue') {
      // AUTH: company_admin (unified contract — see _shared/adminGuard.ts)
      try {
        await requireCompanyAdmin(req);
      } catch (e) {
        return authErrorResponse(e, req);
      }

      const targetUserId = String(body?.target_user_id || '');
      if (!targetUserId) return json({ error: 'missing_target' }, 400);

      const t = rand(32);
      const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
      const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
      const ua = req.headers.get('user-agent') || null;

      const { error: insertErr } = await admin.from('admin_view_as_sessions').insert({
        admin_user_id: callerId,
        target_user_id: targetUserId,
        token: t,
        expires_at: expiresAt,
        ip,
        user_agent: ua,
      });
      if (insertErr) return json({ error: 'issue_failed', detail: insertErr.message }, 500);

      // Best-effort audit log
      await admin.from('audit_logs').insert({
        actor_id: callerId,
        action: 'view_as.issue',
        target_type: 'user',
        target_id: targetUserId,
        detail: { ip, user_agent: ua, expires_at: expiresAt },
      }).then(() => undefined, () => undefined);

      return json({ token: t, expires_at: expiresAt });
    }

    if (action === 'resolve') {
      const t = String(body?.token || '');
      if (!t) return json({ error: 'missing_token' }, 400);

      const { data: row, error: selErr } = await admin
        .from('admin_view_as_sessions')
        .select('*')
        .eq('token', t)
        .maybeSingle();
      if (selErr || !row) return json({ error: 'invalid_token' }, 404);
      if (row.consumed_at) return json({ error: 'already_used' }, 410);
      if (row.revoked_at) return json({ error: 'revoked' }, 410);
      if (new Date(row.expires_at).getTime() < Date.now()) return json({ error: 'expired' }, 410);
      if (row.admin_user_id !== callerId) return json({ error: 'forbidden' }, 403);

      // One-shot: mark consumed
      await admin
        .from('admin_view_as_sessions')
        .update({ consumed_at: new Date().toISOString() })
        .eq('id', row.id);

      // Fetch target identity (email + display_name + roles + subscriptions)
      const nowIso = new Date().toISOString();
      const [
        { data: { user: targetAuth } },
        { data: profile },
        { data: roleRows },
        { data: expertSubs },
        { data: checkupSubs },
      ] = await Promise.all([
        admin.auth.admin.getUserById(row.target_user_id),
        admin.from('profiles').select('display_name').eq('user_id', row.target_user_id).maybeSingle(),
        admin.from('user_roles').select('role').eq('user_id', row.target_user_id),
        admin.from('member_subscriptions')
          .select('id, status, expires_at')
          .eq('user_id', row.target_user_id)
          .eq('status', 'active')
          .or(`expires_at.is.null,expires_at.gt.${nowIso}`),
        admin.from('checkup_subscriptions')
          .select('id, status, expires_at')
          .eq('user_id', row.target_user_id)
          .eq('status', 'active')
          .or(`expires_at.is.null,expires_at.gt.${nowIso}`),
      ]);

      return json({
        admin_user_id: row.admin_user_id,
        target_user_id: row.target_user_id,
        target_email: targetAuth?.email || null,
        target_display_name: profile?.display_name || null,
        target_roles: (roleRows || []).map((r: any) => r.role),
        target_active_expert_subs: (expertSubs || []).length,
        target_active_checkup_subs: (checkupSubs || []).length,
        expires_at: row.expires_at,
      });
    }

    return json({ error: 'unknown_action' }, 400);
  } catch (e: any) {
    console.error('[admin-view-as] error', e);
    return json({ error: 'server_error', detail: e?.message }, 500);
  }
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
