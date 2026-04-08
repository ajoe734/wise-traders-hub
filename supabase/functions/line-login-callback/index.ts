import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LINE_LOGIN_CHANNEL_ID = Deno.env.get('LINE_LOGIN_CHANNEL_ID')!;
    const LINE_LOGIN_CHANNEL_SECRET = Deno.env.get('LINE_LOGIN_CHANNEL_SECRET')!;
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const stateParam = url.searchParams.get('state') || '';
    const error = url.searchParams.get('error');

    // Parse state
    let returnTo = '/free-checkup';
    let redirectUri = '';
    try {
      const stateData = JSON.parse(atob(stateParam));
      returnTo = stateData.return_to || '/free-checkup';
      redirectUri = stateData.redirect_uri || '';
    } catch {}

    if (error || !code) {
      const siteUrl = Deno.env.get('SITE_URL') || 'https://wise-traders-hub.lovable.app';
      return new Response(null, {
        status: 302,
        headers: { Location: `${siteUrl}${returnTo}?line_error=${error || 'no_code'}` },
      });
    }

    // Exchange code for access token
    const callbackUrl = redirectUri || `${url.origin}/line-login-callback`;
    const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: callbackUrl,
        client_id: LINE_LOGIN_CHANNEL_ID,
        client_secret: LINE_LOGIN_CHANNEL_SECRET,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error('LINE token exchange failed:', err);
      const siteUrl = Deno.env.get('SITE_URL') || 'https://wise-traders-hub.lovable.app';
      return new Response(null, {
        status: 302,
        headers: { Location: `${siteUrl}${returnTo}?line_error=token_exchange_failed` },
      });
    }

    const tokenData = await tokenRes.json();

    // Get LINE profile
    const profileRes = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileRes.json();
    const lineUserId = profile.userId;
    const displayName = profile.displayName || 'LINE User';
    const pictureUrl = profile.pictureUrl || null;

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Check if there's already a profile with this line_user_id
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('user_id')
      .eq('line_user_id', lineUserId)
      .maybeSingle();

    let userId: string;

    if (existingProfile) {
      // Existing user
      userId = existingProfile.user_id;
    } else {
      // New user — create account with LINE identity
      const email = `line_${lineUserId}@line.local`;
      const password = crypto.randomUUID(); // Random password, user won't use it

      const { data: newUser, error: signUpError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          name: displayName,
          avatar_url: pictureUrl,
          provider: 'line',
          line_user_id: lineUserId,
        },
      });

      if (signUpError) {
        console.error('Failed to create user:', signUpError);
        const siteUrl = Deno.env.get('SITE_URL') || 'https://wise-traders-hub.lovable.app';
        return new Response(null, {
          status: 302,
          headers: { Location: `${siteUrl}${returnTo}?line_error=signup_failed` },
        });
      }

      userId = newUser.user.id;

      // Update profile with LINE data
      await supabaseAdmin
        .from('profiles')
        .update({
          line_user_id: lineUserId,
          display_name: displayName,
          avatar_url: pictureUrl,
        })
        .eq('user_id', userId);
    }

    // Check if user is friends with the OA via LINE friendship API
    let isFriend = false;
    try {
      const friendRes = await fetch('https://api.line.me/friendship/v1/status', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (friendRes.ok) {
        const friendData = await friendRes.json();
        isFriend = friendData.friendFlag === true;
      }
    } catch (e) {
      console.error('Failed to check friendship:', e);
    }

    // Redirect back with a temporary token for client-side session setup
    // We'll use a short-lived entry in checkup_storage as a session bridge
    const sessionBridgeKey = `line-session-${crypto.randomUUID()}`;
    await supabaseAdmin.from('checkup_storage').upsert({
      key: sessionBridgeKey,
      data: { user_id: userId, line_user_id: lineUserId, is_friend: isFriend, created_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });

    const siteUrl = Deno.env.get('SITE_URL') || 'https://wise-traders-hub.lovable.app';
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${siteUrl}${returnTo}?line_session=${sessionBridgeKey}&line_uid=${lineUserId}&line_name=${encodeURIComponent(displayName)}&line_friend=${isFriend ? '1' : '0'}`,
      },
    });
  } catch (error) {
    console.error('LINE callback error:', error);
    const siteUrl = Deno.env.get('SITE_URL') || 'https://wise-traders-hub.lovable.app';
    return new Response(null, {
      status: 302,
      headers: { Location: `${siteUrl}/free-checkup?line_error=internal` },
    });
  }
});
