import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function randomState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LINE_LOGIN_CHANNEL_ID = Deno.env.get('LINE_LOGIN_CHANNEL_ID');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    if (!LINE_LOGIN_CHANNEL_ID) {
      return new Response(JSON.stringify({ error: 'LINE_LOGIN_CHANNEL_ID not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(req.url);
    const redirectUri = url.searchParams.get('redirect_uri') || '';
    const returnTo = url.searchParams.get('return_to') || '/holding-checkup';
    const appOrigin = url.searchParams.get('app_origin') || '';

    // CSRF-safe state: random nonce persisted server-side (10min TTL, single-use).
    const state = randomState();
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { error: stateErr } = await supabaseAdmin
      .from('line_oauth_states')
      .insert({
        state,
        payload: { redirect_uri: redirectUri, return_to: returnTo, app_origin: appOrigin },
        expires_at: expiresAt,
      });
    if (stateErr) {
      console.error('[LINE-AUTH-FN] state insert failed:', stateErr);
      return new Response(JSON.stringify({ error: 'state_persist_failed' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const callbackUrl = redirectUri || `${url.origin}/line-login-callback`;
    const lineAuthUrl = new URL('https://access.line.me/oauth2/v2.1/authorize');
    lineAuthUrl.searchParams.set('response_type', 'code');
    lineAuthUrl.searchParams.set('client_id', LINE_LOGIN_CHANNEL_ID);
    lineAuthUrl.searchParams.set('redirect_uri', callbackUrl);
    lineAuthUrl.searchParams.set('state', state);
    lineAuthUrl.searchParams.set('scope', 'profile openid');
    lineAuthUrl.searchParams.set('bot_prompt', 'normal');

    return new Response(null, {
      status: 302,
      headers: { ...corsHeaders, 'Location': lineAuthUrl.toString() },
    });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

