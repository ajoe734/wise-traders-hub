// AUTH: user  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// Generate a 6-digit account-link code for the current authenticated user.
// The user who calls this becomes the PRIMARY (canonical) account after merge.

import { serviceClient, userClient } from '../_shared/supabaseClients.ts';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function gen6(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization') ?? '';

    const userClient = userClient(req);
    const admin = serviceClient();

    const { data: authData, error: authErr } = await userClient.auth.getUser();
    if (authErr || !authData.user) {
      return new Response(JSON.stringify({ error: 'AUTH_REQUIRED' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const uid = authData.user.id;
    const email = authData.user.email ?? '';
    const isLine = email.endsWith('@line.local');

    // Refuse if this user has already been merged as a secondary
    const { data: prof } = await admin.from('profiles').select('merged_into_user_id, line_user_id').eq('user_id', uid).maybeSingle();
    if (prof?.merged_into_user_id) {
      return new Response(JSON.stringify({ error: 'ALREADY_MERGED_SECONDARY', primary_user_id: prof.merged_into_user_id }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Generate a unique code (retry a few times)
    let code = '';
    for (let i = 0; i < 6; i++) {
      const candidate = gen6();
      const { data: existing } = await admin
        .from('account_link_codes')
        .select('id')
        .eq('code', candidate)
        .is('consumed_at', null)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();
      if (!existing) { code = candidate; break; }
    }
    if (!code) {
      return new Response(JSON.stringify({ error: 'CODE_GEN_FAILED' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { data: inserted, error: insErr } = await admin
      .from('account_link_codes')
      .insert({
        code,
        initiator_user_id: uid,
        initiator_identity: isLine ? 'line' : 'email',
        initiator_email: isLine ? null : email,
        initiator_line_user_id: isLine ? (prof?.line_user_id ?? null) : null,
        expires_at,
      })
      .select('code, expires_at, initiator_identity')
      .single();

    if (insErr) throw insErr;

    return new Response(JSON.stringify({ ok: true, code: inserted.code, expires_at: inserted.expires_at, initiator_identity: inserted.initiator_identity }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[account-link-generate] error', e);
    return new Response(JSON.stringify({ error: 'INTERNAL', message: String((e as Error)?.message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
