// Consume a 6-digit account-link code.
// The CURRENT caller becomes the SECONDARY; the code initiator is the PRIMARY.
// All of the secondary's data is moved to the primary; the secondary auth user is disabled.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Tables whose rows must be re-pointed from secondary -> primary via user_id column.
// (Grouped so we can count moved rows in the audit log.)
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization') ?? '';

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(url, service);

    const { data: authData, error: authErr } = await userClient.auth.getUser();
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

    // Look up code
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

    // Guard: neither side may already be a merged secondary
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

    // Move data from secondary -> primary
    const movedCounts: Record<string, number> = {};
    for (const tbl of USER_ID_TABLES) {
      const { data, error } = await admin
        .from(tbl)
        .update({ user_id: primaryUid })
        .eq('user_id', secondaryUid)
        .select('user_id');
      if (error) {
        console.error(`[account-link-consume] move ${tbl} failed`, error);
        // Continue — we prefer partial move over total failure; report counts back.
        movedCounts[tbl] = -1;
      } else {
        movedCounts[tbl] = data?.length ?? 0;
      }
    }

    // Merge profile fields: pull LINE identity onto primary if secondary is LINE and primary has none
    if (secondaryIsLine && secondaryProf?.line_user_id && !primaryProf?.line_user_id) {
      await admin.from('profiles').update({ line_user_id: secondaryProf.line_user_id }).eq('user_id', primaryUid);
    }
    if (!primaryProf?.avatar_url && secondaryProf?.avatar_url) {
      await admin.from('profiles').update({ avatar_url: secondaryProf.avatar_url }).eq('user_id', primaryUid);
    }

    // Mark secondary profile as merged & clear its LINE binding to avoid dup
    await admin
      .from('profiles')
      .update({ merged_into_user_id: primaryUid, line_user_id: null })
      .eq('user_id', secondaryUid);

    // Disable secondary auth user (rename email so it cannot conflict later; ban)
    try {
      const stashEmail = `merged_${secondaryUid}@merged.local`;
      await admin.auth.admin.updateUserById(secondaryUid, {
        email: stashEmail,
        user_metadata: { merged_into: primaryUid, merged_at: new Date().toISOString(), original_email: secondaryEmail },
        ban_duration: '876000h', // ~100y
      } as any);
    } catch (e) {
      console.error('[account-link-consume] disable secondary failed', e);
    }

    // Mark code consumed
    await admin
      .from('account_link_codes')
      .update({ consumed_at: new Date().toISOString(), consumed_by_user_id: secondaryUid })
      .eq('id', rec.id);

    // Audit
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

    return new Response(JSON.stringify({ ok: true, primary_user_id: primaryUid, moved_counts: movedCounts }), {
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
