import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LINE_LOGIN_CHANNEL_ID = Deno.env.get('LINE_LOGIN_CHANNEL_ID');
    if (!LINE_LOGIN_CHANNEL_ID) {
      return new Response(JSON.stringify({ error: 'LINE_LOGIN_CHANNEL_ID not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(req.url);
    const redirectUri = url.searchParams.get('redirect_uri') || '';
    const returnTo = url.searchParams.get('return_to') || '/free-checkup';
    const appOrigin = url.searchParams.get('app_origin') || '';

    // Build state with return_to for post-login redirect
    const state = btoa(JSON.stringify({
      redirect_uri: redirectUri,
      return_to: returnTo,
      app_origin: appOrigin,
      ts: Date.now(),
    }));

    // Build LINE Login authorization URL
    // bot_prompt=aggressive → forces "Add friend" dialog for OA
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
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
