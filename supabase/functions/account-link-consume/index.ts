// AUTH: user  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// Consume a 6-digit account-link code.
// The CURRENT caller becomes the SECONDARY; the code initiator is the PRIMARY.
// All of the secondary's data is moved to the primary; the secondary auth user is disabled.

import { serviceClient, userClient } from '../_shared/supabaseClients.ts';
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


type SubRow = { id: string; user_id: string; plan_id: string; expires_at: string | null };
type ConflictReport = {
  canceled_count: number;
  groups: Array<{
    plan_id: string;
    kept: { id: string; user_id: string; expires_at: string | null };
    canceled: Array<{ id: string; user_id: string; expires_at: string | null }>;
  }>;
};

/**
 * Cancel overlapping active subscriptions BEFORE the user_id re-point.
 * Winner = latest expires_at; losers get canceled (status=canceled, canceled_at=now).
 * Returns a structured report used for audit_logs / account_merges.moved_counts.
 */
async function resolveActiveSubConflicts(
  admin: any,
  primaryUid: string,
  secondaryUid: string,
): Promise<ConflictReport> {
  const { data: rows } = await admin
    .from('member_subscriptions')
    .select('id, user_id, plan_id, expires_at')
    .in('user_id', [primaryUid, secondaryUid])
    .eq('status', 'active');
  const byPlan = new Map<string, SubRow[]>();
  for (const r of (rows ?? []) as SubRow[]) {
    if (!byPlan.has(r.plan_id)) byPlan.set(r.plan_id, []);
    byPlan.get(r.plan_id)!.push(r);
  }
  const losers: string[] = [];
  const groups: ConflictReport['groups'] = [];
  for (const [plan_id, list] of byPlan) {
    if (list.length < 2) continue;
    list.sort((a, b) => {
      const ax = a.expires_at ? new Date(a.expires_at).getTime() : 0;
      const bx = b.expires_at ? new Date(b.expires_at).getTime() : 0;
      return bx - ax;
    });
    const [kept, ...rest] = list;
    groups.push({
      plan_id,
      kept: { id: kept.id, user_id: kept.user_id, expires_at: kept.expires_at },
      canceled: rest.map((r) => ({ id: r.id, user_id: r.user_id, expires_at: r.expires_at })),
    });
    for (const r of rest) losers.push(r.id);
  }
  if (losers.length) {
    const { error } = await admin
      .from('member_subscriptions')
      .update({ status: 'canceled', canceled_at: new Date().toISOString() })
      .in('id', losers);
    if (error) console.error('[merge] cancel sub conflicts failed', error);
  }
  return { canceled_count: losers.length, groups };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization') ?? '';

    const uc = userClient(req);
    const admin = serviceClient();

    const { data: authData, error: authErr } = await uc.auth.getUser();
    if (authErr || !authData.user) {
      return new Response(JSON.stringify({ error: 'AUTH_REQUIRED' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const secondaryUid = authData.user.id;
    const secondaryEmail = authData.user.email ?? '';
    const secondaryIsLine = secondaryEmail.endsWith('@line.local');

    const body = await req.json().catch(() => ({}));
    const raw = String(body?.code ?? '').trim();
    const code = raw.replace(/\D/g, '');
    if (!/^\d{6}$/.test(code)) {
      return new Response(JSON.stringify({ error: 'INVALID_CODE' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: rec, error: recErr } = await admin
      .from('account_link_codes')
      .select('*')
      .eq('code', code)
      .maybeSingle();
    if (recErr || !rec) {
      return new Response(JSON.stringify({ error: 'CODE_NOT_FOUND' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (rec.consumed_at) {
      return new Response(JSON.stringify({ error: 'CODE_ALREADY_USED' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (new Date(rec.expires_at).getTime() < Date.now()) {
      return new Response(JSON.stringify({ error: 'CODE_EXPIRED' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const primaryUid = rec.initiator_user_id as string;
    if (primaryUid === secondaryUid) {
      return new Response(JSON.stringify({ error: 'SAME_ACCOUNT' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: profs } = await admin
      .from('profiles')
      .select('user_id, merged_into_user_id, line_user_id, display_name, avatar_url')
      .in('user_id', [primaryUid, secondaryUid]);
    const primaryProf = profs?.find((p) => p.user_id === primaryUid);
    const secondaryProf = profs?.find((p) => p.user_id === secondaryUid);
    if (primaryProf?.merged_into_user_id) {
      return new Response(JSON.stringify({ error: 'PRIMARY_ALREADY_MERGED' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (secondaryProf?.merged_into_user_id) {
      return new Response(JSON.stringify({ error: 'SECONDARY_ALREADY_MERGED' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const subConflicts = await resolveActiveSubConflicts(admin, primaryUid, secondaryUid);

    const movedCounts: Record<string, unknown> = {
      _sub_conflicts_canceled: subConflicts.canceled_count,
      _sub_conflicts: subConflicts.groups,
    };
    for (const tbl of USER_ID_TABLES) {
      const { data, error } = await admin
        .from(tbl)
        .update({ user_id: primaryUid })
        .eq('user_id', secondaryUid)
        .select('user_id');
      if (error) {
        console.error(`[account-link-consume] move ${tbl} failed`, error);
        movedCounts[tbl] = -1;
      } else {
        movedCounts[tbl] = data?.length ?? 0;
      }
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
      const stashEmail = `merged_${secondaryUid}@merged.local`;
      await admin.auth.admin.updateUserById(secondaryUid, {
        email: stashEmail,
        user_metadata: { merged_into: primaryUid, merged_at: new Date().toISOString(), original_email: secondaryEmail },
        ban_duration: '876000h',
      } as any);
    } catch (e) {
      console.error('[account-link-consume] disable secondary failed', e);
    }

    await admin
      .from('account_link_codes')
      .update({ consumed_at: new Date().toISOString(), consumed_by_user_id: secondaryUid })
      .eq('id', rec.id);

    await admin.from('account_merges').insert({
      primary_user_id: primaryUid,
      secondary_user_id: secondaryUid,
      primary_identity: rec.initiator_identity,
      secondary_identity: secondaryIsLine ? 'line' : 'email',
      primary_email: rec.initiator_email,
      secondary_email: secondaryEmail,
      moved_counts: movedCounts,
      performed_by: secondaryUid,
    });

    try {
      await admin.from('audit_logs').insert({
        actor_id: secondaryUid,
        action: 'account_link_consume',
        target_type: 'user',
        target_id: secondaryUid,
        detail: {
          primary_user_id: primaryUid,
          secondary_user_id: secondaryUid,
          moved_counts: movedCounts,
          sub_conflicts: subConflicts,
          at: new Date().toISOString(),
        },
      });
    } catch (e) {
      console.warn('[account-link-consume] audit insert failed', e);
    }

    return new Response(JSON.stringify({ ok: true, primary_user_id: primaryUid, moved_counts: movedCounts, sub_conflicts: subConflicts }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[account-link-consume] error', e);
    return new Response(JSON.stringify({ error: 'INTERNAL', message: String((e as Error)?.message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
