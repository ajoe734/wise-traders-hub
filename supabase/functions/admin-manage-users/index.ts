// AUTH: user  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)

import { corsHeaders } from '../_shared/cors.ts';
import { serviceClient, userClient } from '../_shared/supabaseClients.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
import { validateInput, validationResponse } from '../_shared/inputValidator.ts';
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
    signal: AbortSignal.timeout(10000),
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

Deno.serve(withLogging('admin-manage-users', async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    // AUTH: company_admin (unified contract — see _shared/adminGuard.ts)
    let callerId: string;
    try {
      callerId = await requireCompanyAdmin(req);
    } catch (e) {
      return authErrorResponse(e, req);
    }

    const admin = serviceClient();
    const body = await req.json().catch(() => ({}));
    const actionIssues = validateInput({
      fields: {
        action: {
          required: true,
          type: 'string',
          oneOf: ['list', 'set_role', 'set_tester', 'set_banned', 'send_password_reset', 'update_profile', 'delete_user', 'lookup_identities', 'create_user'],
          label: 'action',
        },
      },
      source: body,
    });
    if (actionIssues.length) return validationResponse(actionIssues, corsHeaders);
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
      const authById = new Map<string, { email: string; banned_until: string | null; last_sign_in_at: string | null }>();
      (usersList?.users || []).forEach((u: any) =>
        authById.set(u.id, {
          email: u.email || '',
          banned_until: u.banned_until || null,
          last_sign_in_at: u.last_sign_in_at || null,
        }),
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
          last_sign_in_at: a?.last_sign_in_at || null,
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

      let expertCreated = false;
      let expertKept = false;
      let expertId: string | null = null;

      if (enabled) {
        const { error } = await admin
          .from('user_roles')
          .upsert({ user_id: targetId, role }, { onConflict: 'user_id,role' });
        if (error) return json({ error: error.message }, 500);

        // 授予 analyst 時，若尚無 experts row，自動建立骨架，避免分析師頁看不到人
        if (role === 'analyst') {
          const { data: existingExpert } = await admin
            .from('experts')
            .select('id')
            .eq('user_id', targetId)
            .maybeSingle();
          if (existingExpert) {
            expertId = existingExpert.id;
          } else {
            // 取 name / email 做預設值
            const { data: prof } = await admin
              .from('profiles')
              .select('display_name')
              .eq('user_id', targetId)
              .maybeSingle();
            const { data: authRes } = await admin.auth.admin.getUserById(targetId);
            const email = authRes?.user?.email || '';
            const emailPrefix = email.split('@')[0] || '';
            const defaultName = prof?.display_name || emailPrefix || `user-${targetId.slice(0, 8)}`;
            const defaultSlug = `pending-${targetId.slice(0, 8)}`;
            const { data: newExpert, error: expErr } = await admin
              .from('experts')
              .insert({
                user_id: targetId,
                slug: defaultSlug,
                name: defaultName,
                role: 'mentor',
                status: 'pending',
                created_by: callerId,
              })
              .select('id')
              .single();
            if (expErr) return json({ error: `expert_create_failed: ${expErr.message}` }, 500);
            expertId = newExpert.id;
            expertCreated = true;
          }
        }
      } else {
        const { error } = await admin
          .from('user_roles')
          .delete()
          .eq('user_id', targetId)
          .eq('role', role);
        if (error) return json({ error: error.message }, 500);

        // 回收 analyst role 時，若對應 expert 未 active 且無訂閱者，軟停用
        if (role === 'analyst') {
          const { data: existingExpert } = await admin
            .from('experts')
            .select('id, status')
            .eq('user_id', targetId)
            .maybeSingle();
          if (existingExpert) {
            expertId = existingExpert.id;
            if (existingExpert.status !== 'active') {
              await admin
                .from('experts')
                .update({ status: 'suspended' })
                .eq('id', existingExpert.id);
              expertKept = true;
            } else {
              // active 分析師保留，只回收 role
              expertKept = true;
            }
          }
        }
      }

      await admin.from('audit_logs').insert({
        actor_id: callerId,
        action: enabled ? 'role.grant' : 'role.revoke',
        target_id: targetId,
        target_type: 'user',
        detail: { role, enabled, expert_created: expertCreated, expert_kept: expertKept, expert_id: expertId },
      });

      return json({
        ok: true,
        expert_created: expertCreated,
        expert_kept: expertKept,
        expert_id: expertId,
        needs_setup: expertCreated,
      });
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

    if (action === 'create_user') {
      const email = (body?.email || '').toString().trim().toLowerCase();
      const password = (body?.password || '').toString();
      const displayName = (body?.display_name || '').toString().trim() || null;
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'invalid_email' }, 400);
      if (!password || password.length < 8) return json({ error: 'password_too_short' }, 400);

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: displayName ? { name: displayName } : {},
      });
      if (createErr) return json({ error: createErr.message }, 400);
      const newId = created.user?.id;
      if (!newId) return json({ error: 'create_failed' }, 500);

      if (displayName) {
        await admin.from('profiles').update({ display_name: displayName }).eq('user_id', newId);
      }

      await admin.from('audit_logs').insert({
        actor_id: callerId,
        action: 'account.create',
        target_id: newId,
        target_type: 'user',
        detail: { email, display_name: displayName },
      });
      return json({ ok: true, user_id: newId, email });
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

    if (action === 'lookup_identities') {
      const userIds = Array.isArray(body?.user_ids) ? (body.user_ids as string[]).filter(Boolean) : [];
      if (userIds.length === 0) return json({ identities: [] });
      if (userIds.length > 500) return json({ error: 'too_many_ids' }, 400);

      const { data: profiles } = await admin
        .from('profiles')
        .select('user_id, display_name, line_user_id')
        .in('user_id', userIds);

      const { data: usersList } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const emailById = new Map<string, string>();
      (usersList?.users || []).forEach((u: any) => emailById.set(u.id, u.email || ''));

      const profileById = new Map<string, any>();
      (profiles || []).forEach((p) => profileById.set(p.user_id, p));

      const identities = userIds.map((uid) => {
        const p = profileById.get(uid) || {};
        const email = emailById.get(uid) || '';
        const isLine = !!p.line_user_id || email.endsWith('@line.local');
        return {
          user_id: uid,
          display_name: p.display_name || null,
          email,
          line_user_id: p.line_user_id || null,
          login_method: isLine ? 'line' : 'email',
        };
      });

      return json({ identities });
    }

    return json({ error: 'unknown_action' }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
}));
