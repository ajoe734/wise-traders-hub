import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401);

    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: 'unauthorized' }, 401);
    const callerId = userData.user.id;

    const { data: isAdmin, error: roleErr } = await callerClient.rpc('has_role', {
      _user_id: callerId,
      _role: 'company_admin',
    });
    if (roleErr || !isAdmin) return json({ error: 'forbidden' }, 403);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json().catch(() => ({}));
    const action = body?.action as string;

    if (action === 'list') {
      const search = (body?.search || '').toString().trim().toLowerCase();
      const limit = Math.min(Number(body?.limit) || 100, 200);

      // Pull profiles + roles + line bindings, then enrich with auth.users emails
      const { data: profiles } = await admin
        .from('profiles')
        .select('user_id, display_name, avatar_url, expert_slug, is_tester, line_user_id, created_at')
        .order('created_at', { ascending: false })
        .limit(500);

      const ids = (profiles || []).map((p) => p.user_id);
      const { data: roles } = await admin
        .from('user_roles')
        .select('user_id, role')
        .in('user_id', ids);

      const rolesByUser = new Map<string, string[]>();
      (roles || []).forEach((r) => {
        const arr = rolesByUser.get(r.user_id) || [];
        arr.push(r.role);
        rolesByUser.set(r.user_id, arr);
      });

      // Get emails via auth admin API (batch by 1000)
      const { data: usersList } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const emailById = new Map<string, string>();
      (usersList?.users || []).forEach((u) => emailById.set(u.id, u.email || ''));

      let rows = (profiles || []).map((p) => ({
        user_id: p.user_id,
        email: emailById.get(p.user_id) || '',
        display_name: p.display_name,
        avatar_url: p.avatar_url,
        expert_slug: p.expert_slug,
        is_tester: !!p.is_tester,
        is_line: !!p.line_user_id,
        roles: rolesByUser.get(p.user_id) || [],
        created_at: p.created_at,
      }));

      if (search) {
        rows = rows.filter(
          (r) =>
            r.email.toLowerCase().includes(search) ||
            (r.display_name || '').toLowerCase().includes(search) ||
            (r.expert_slug || '').toLowerCase().includes(search) ||
            r.user_id.toLowerCase().includes(search),
        );
      }

      return json({ users: rows.slice(0, limit), total: rows.length });
    }

    if (action === 'set_role') {
      const targetId = body?.user_id as string;
      const role = body?.role as string;
      const enabled = !!body?.enabled;
      if (!targetId || !['company_admin', 'analyst'].includes(role)) {
        return json({ error: 'invalid_params' }, 400);
      }

      // Self-protection: cannot remove own company_admin
      if (!enabled && role === 'company_admin' && targetId === callerId) {
        return json({ error: 'cannot_remove_self_admin' }, 400);
      }

      // Last-admin protection
      if (!enabled && role === 'company_admin') {
        const { count } = await admin
          .from('user_roles')
          .select('user_id', { count: 'exact', head: true })
          .eq('role', 'company_admin');
        if ((count || 0) <= 1) return json({ error: 'last_admin' }, 400);
      }

      if (enabled) {
        const { error } = await admin
          .from('user_roles')
          .upsert({ user_id: targetId, role }, { onConflict: 'user_id,role' });
        if (error) return json({ error: error.message }, 500);
      } else {
        const { error } = await admin
          .from('user_roles')
          .delete()
          .eq('user_id', targetId)
          .eq('role', role);
        if (error) return json({ error: error.message }, 500);
      }

      await admin.from('audit_logs').insert({
        actor_id: callerId,
        action: enabled ? 'role.grant' : 'role.revoke',
        target_id: targetId,
        target_type: 'user',
        detail: { role, enabled },
      });

      return json({ ok: true });
    }

    if (action === 'set_tester') {
      const targetId = body?.user_id as string;
      const value = !!body?.value;
      if (!targetId) return json({ error: 'invalid_params' }, 400);

      const { data: prev } = await admin
        .from('profiles')
        .select('is_tester')
        .eq('user_id', targetId)
        .maybeSingle();

      const { error } = await admin
        .from('profiles')
        .update({ is_tester: value })
        .eq('user_id', targetId);
      if (error) return json({ error: error.message }, 500);

      await admin.from('audit_logs').insert({
        actor_id: callerId,
        action: 'tester.toggle',
        target_id: targetId,
        target_type: 'user',
        detail: { from: prev?.is_tester ?? null, to: value },
      });
      return json({ ok: true });
    }

    return json({ error: 'unknown_action' }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
