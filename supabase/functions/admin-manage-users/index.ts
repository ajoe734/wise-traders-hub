import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const SITE_URL = Deno.env.get('SITE_URL') || 'https://legendflow.tw';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function sendPasswordResetEmail(email: string, link: string) {
  if (!RESEND_API_KEY) throw new Error('email_not_configured');
  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px; color: #1a1a1a;">
      <h2 style="font-weight: 500; font-size: 20px; margin: 0 0 16px;">重設您的密碼</h2>
      <p style="font-size: 14px; line-height: 1.7; color: #555;">
        我們收到了重設密碼的請求。點擊下方按鈕設定新密碼，連結將在 60 分鐘後失效。
      </p>
      <p style="margin: 24px 0;">
        <a href="${link}" style="display: inline-block; background: #1a1a1a; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 14px;">設定新密碼</a>
      </p>
      <p style="font-size: 12px; color: #999;">如非您本人操作，請忽略此信。</p>
      <p style="font-size: 12px; color: #999; word-break: break-all;">${link}</p>
    </div>
  `;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from: 'LegendFlow <noreply@legendflow.tw>',
      to: [email],
      subject: '【LegendFlow】重設您的密碼',
      html,
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`resend_failed: ${t}`);
  }
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

      const { data: usersList } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const authById = new Map<string, { email: string; banned_until: string | null }>();
      (usersList?.users || []).forEach((u: any) =>
        authById.set(u.id, { email: u.email || '', banned_until: u.banned_until || null }),
      );

      let rows = (profiles || []).map((p) => {
        const a = authById.get(p.user_id);
        return {
          user_id: p.user_id,
          email: a?.email || '',
          display_name: p.display_name,
          avatar_url: p.avatar_url,
          expert_slug: p.expert_slug,
          is_tester: !!p.is_tester,
          is_line: !!p.line_user_id,
          banned_until: a?.banned_until || null,
          roles: rolesByUser.get(p.user_id) || [],
          created_at: p.created_at,
        };
      });

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
      if (!enabled && role === 'company_admin' && targetId === callerId) {
        return json({ error: 'cannot_remove_self_admin' }, 400);
      }
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

    if (action === 'set_banned') {
      const targetId = body?.user_id as string;
      const banned = !!body?.banned;
      if (!targetId) return json({ error: 'invalid_params' }, 400);
      if (banned && targetId === callerId) return json({ error: 'cannot_ban_self' }, 400);

      const { error } = await admin.auth.admin.updateUserById(targetId, {
        ban_duration: banned ? '876000h' : 'none',
      } as any);
      if (error) return json({ error: error.message }, 500);

      await admin.from('audit_logs').insert({
        actor_id: callerId,
        action: banned ? 'account.ban' : 'account.unban',
        target_id: targetId,
        target_type: 'user',
        detail: { banned },
      });
      return json({ ok: true });
    }

    if (action === 'send_password_reset') {
      const targetId = body?.user_id as string;
      if (!targetId) return json({ error: 'invalid_params' }, 400);

      const { data: u, error: getErr } = await admin.auth.admin.getUserById(targetId);
      if (getErr || !u?.user?.email) return json({ error: 'user_not_found' }, 404);
      const email = u.user.email;
      if (email.endsWith('@line.local')) return json({ error: 'line_account_no_email' }, 400);

      const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: { redirectTo: `${SITE_URL}/auth/reset-password` },
      });
      if (linkErr) return json({ error: linkErr.message }, 500);

      const link = (linkData as any)?.properties?.action_link;
      if (!link) return json({ error: 'no_link' }, 500);

      try {
        await sendPasswordResetEmail(email, link);
      } catch (e) {
        return json({ error: String((e as Error).message) }, 500);
      }

      await admin.from('audit_logs').insert({
        actor_id: callerId,
        action: 'account.password_reset',
        target_id: targetId,
        target_type: 'user',
        detail: { email },
      });
      return json({ ok: true });
    }

    if (action === 'update_profile') {
      const targetId = body?.user_id as string;
      if (!targetId) return json({ error: 'invalid_params' }, 400);
      const updates: Record<string, any> = {};
      if (typeof body?.display_name === 'string') updates.display_name = body.display_name.trim() || null;
      if (typeof body?.expert_slug === 'string') {
        const s = body.expert_slug.trim();
        updates.expert_slug = s || null;
      }
      if (Object.keys(updates).length === 0) return json({ error: 'no_changes' }, 400);

      const { data: prev } = await admin
        .from('profiles')
        .select('display_name, expert_slug')
        .eq('user_id', targetId)
        .maybeSingle();

      const { error } = await admin.from('profiles').update(updates).eq('user_id', targetId);
      if (error) return json({ error: error.message }, 400);

      await admin.from('audit_logs').insert({
        actor_id: callerId,
        action: 'account.update_profile',
        target_id: targetId,
        target_type: 'user',
        detail: { from: prev, to: updates },
      });
      return json({ ok: true });
    }

    if (action === 'delete_user') {
      const targetId = body?.user_id as string;
      if (!targetId) return json({ error: 'invalid_params' }, 400);
      if (targetId === callerId) return json({ error: 'cannot_delete_self' }, 400);

      // Last admin protection
      const { data: targetRoles } = await admin
        .from('user_roles')
        .select('role')
        .eq('user_id', targetId);
      if ((targetRoles || []).some((r: any) => r.role === 'company_admin')) {
        const { count } = await admin
          .from('user_roles')
          .select('user_id', { count: 'exact', head: true })
          .eq('role', 'company_admin');
        if ((count || 0) <= 1) return json({ error: 'last_admin' }, 400);
      }

      const { data: u } = await admin.auth.admin.getUserById(targetId);
      const email = u?.user?.email || '';

      const { error } = await admin.auth.admin.deleteUser(targetId);
      if (error) return json({ error: error.message }, 500);

      await admin.from('audit_logs').insert({
        actor_id: callerId,
        action: 'account.delete',
        target_id: targetId,
        target_type: 'user',
        detail: { email },
      });
      return json({ ok: true });
    }

    return json({ error: 'unknown_action' }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
