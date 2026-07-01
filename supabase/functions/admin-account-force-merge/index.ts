// Admin-only: force-merge secondary_user_id INTO primary_user_id without a code.
// Used by /company/subscribers "代客綁定" when the member can't run the flow himself.
// Same data-movement semantics as account-link-consume.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const USER_ID_TABLES = [
  'member_subscriptions',
  'checkup_subscriptions',
  'checkup_usage',
  'checkup_entitlements',
  'checkup_trade_memos',
  'checkup_storage',
  'checkup_analysis_jobs',
  'checkup_daily_reminders',
  'notifications',
  'notification_preferences',
  'user_performances',
  'user_summaries',
  'holding_meta_overrides',
  'member_line_bindings',
  'referral_attributions',
  'conversions',
  'remittance_orders',
  'payment_intents',
  'payment_transactions',
  'paywall_events',
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Cancel overlapping active member_subscriptions before moving. See account-link-consume.
async function resolveActiveSubConflicts(admin: any, primaryUid: string, secondaryUid: string) {
  const { data: rows } = await admin
    .from('member_subscriptions')
    .select('id, user_id, plan_id, expires_at')
    .in('user_id', [primaryUid, secondaryUid])
    .eq('status', 'active');
  const byPlan = new Map<string, any[]>();
  for (const r of rows ?? []) {
    if (!byPlan.has(r.plan_id)) byPlan.set(r.plan_id, []);
    byPlan.get(r.plan_id)!.push(r);
  }
  const losers: string[] = [];
  for (const [, list] of byPlan) {
    if (list.length < 2) continue;
    list.sort((a, b) => (b.expires_at ? new Date(b.expires_at).getTime() : 0) - (a.expires_at ? new Date(a.expires_at).getTime() : 0));
    for (let i = 1; i < list.length; i++) losers.push(list[i].id);
  }
  if (!losers.length) return 0;
  const { error } = await admin
    .from('member_subscriptions')
    .update({ status: 'canceled', canceled_at: new Date().toISOString() })
    .in('id', losers);
  if (error) console.error('[admin-force-merge] cancel sub conflicts failed', error);
  return losers.length;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'AUTH_REQUIRED' }, 401);

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(url, service);

    const { data: authData } = await userClient.auth.getUser();
    const callerId = authData?.user?.id;
    if (!callerId) return json({ error: 'AUTH_REQUIRED' }, 401);

    const { data: hasRole } = await admin.rpc('has_role', { _user_id: callerId, _role: 'company_admin' });
    if (!hasRole) return json({ error: 'FORBIDDEN' }, 403);

    const body = await req.json().catch(() => ({}));
    const primaryUid = String(body?.primary_user_id ?? '').trim();
    const secondaryUid = String(body?.secondary_user_id ?? '').trim();
    if (!primaryUid || !secondaryUid) return json({ error: 'MISSING_IDS' }, 400);
    if (primaryUid === secondaryUid) return json({ error: 'SAME_ACCOUNT' }, 400);

    // Guardrails
    const { data: profs } = await admin
      .from('profiles')
      .select('user_id, merged_into_user_id, line_user_id, avatar_url')
      .in('user_id', [primaryUid, secondaryUid]);
    const primaryProf = profs?.find((p) => p.user_id === primaryUid);
    const secondaryProf = profs?.find((p) => p.user_id === secondaryUid);
    if (primaryProf?.merged_into_user_id) return json({ error: 'PRIMARY_ALREADY_MERGED' }, 400);
    if (secondaryProf?.merged_into_user_id) return json({ error: 'SECONDARY_ALREADY_MERGED' }, 400);

    // Look up both auth users for audit + email stash
    const [{ data: primaryAuth }, { data: secondaryAuth }] = await Promise.all([
      admin.auth.admin.getUserById(primaryUid),
      admin.auth.admin.getUserById(secondaryUid),
    ]);
    const primaryEmail = primaryAuth?.user?.email ?? null;
    const secondaryEmail = secondaryAuth?.user?.email ?? '';
    const primaryIsLine = primaryEmail?.endsWith('@line.local') ?? false;
    const secondaryIsLine = secondaryEmail.endsWith('@line.local');

    const subConflictsCanceled = await resolveActiveSubConflicts(admin, primaryUid, secondaryUid);
    const movedCounts: Record<string, number> = { _sub_conflicts_canceled: subConflictsCanceled };
    for (const tbl of USER_ID_TABLES) {
      const { data, error } = await admin
        .from(tbl)
        .update({ user_id: primaryUid })
        .eq('user_id', secondaryUid)
        .select('user_id');
      movedCounts[tbl] = error ? -1 : (data?.length ?? 0);
      if (error) console.error(`[admin-force-merge] ${tbl} failed`, error);
    }

    if (secondaryIsLine && secondaryProf?.line_user_id && !primaryProf?.line_user_id) {
      await admin.from('profiles').update({ line_user_id: secondaryProf.line_user_id }).eq('user_id', primaryUid);
    }
    if (!primaryProf?.avatar_url && secondaryProf?.avatar_url) {
      await admin.from('profiles').update({ avatar_url: secondaryProf.avatar_url }).eq('user_id', primaryUid);
    }

    await admin
      .from('profiles')
      .update({ merged_into_user_id: primaryUid, line_user_id: null })
      .eq('user_id', secondaryUid);

    try {
      await admin.auth.admin.updateUserById(secondaryUid, {
        email: `merged_${secondaryUid}@merged.local`,
        user_metadata: {
          merged_into: primaryUid,
          merged_at: new Date().toISOString(),
          merged_by_admin: callerId,
          original_email: secondaryEmail,
        },
        ban_duration: '876000h',
      } as unknown as Record<string, unknown>);
    } catch (e) {
      console.error('[admin-force-merge] disable secondary failed', e);
    }

    await admin.from('account_merges').insert({
      primary_user_id: primaryUid,
      secondary_user_id: secondaryUid,
      primary_identity: primaryIsLine ? 'line' : 'email',
      secondary_identity: secondaryIsLine ? 'line' : 'email',
      primary_email: primaryEmail,
      secondary_email: secondaryEmail,
      moved_counts: movedCounts,
      performed_by: callerId,
    });

    try {
      await admin.from('audit_logs').insert({
        actor_user_id: callerId,
        action: 'admin_account_force_merge',
        target_type: 'user',
        target_id: secondaryUid,
        payload: { primary_user_id: primaryUid, moved_counts: movedCounts },
      });
    } catch (e) {
      console.warn('[admin-force-merge] audit insert failed', e);
    }

    return json({ ok: true, moved_counts: movedCounts });
  } catch (e) {
    console.error('[admin-force-merge] error', e);
    return json({ error: 'INTERNAL', message: String((e as Error)?.message ?? e) }, 500);
  }
});
