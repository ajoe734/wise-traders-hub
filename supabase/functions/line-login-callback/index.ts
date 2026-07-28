// AUTH: public  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import { corsHeaders } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/supabaseClients.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
serve(withLogging('line-login-callback', async (req) => {
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

    // Resolve state via server-side nonce store (CSRF + replay protection).
    // S5 hardening: legacy base64 fallback removed — by now the cutover is complete
    // and accepting attacker-crafted base64 state would bypass CSRF entirely.
    let returnTo = '/holding-checkup';
    let redirectUri = '';
    let appOrigin = '';
    const supabaseAdmin = serviceClient();

    let stateOk = false;
    if (stateParam) {
      const { data: stateRow } = await supabaseAdmin
        .from('line_oauth_states')
        .select('payload, expires_at, consumed_at')
        .eq('state', stateParam)
        .maybeSingle();
      if (stateRow && !stateRow.consumed_at && new Date(stateRow.expires_at) > new Date()) {
        const payload = (stateRow.payload || {}) as Record<string, string>;
        returnTo = payload.return_to || '/holding-checkup';
        redirectUri = payload.redirect_uri || '';
        appOrigin = payload.app_origin || '';
        const { error: consumeErr, count } = await supabaseAdmin
          .from('line_oauth_states')
          .update({ consumed_at: new Date().toISOString() }, { count: 'exact' })
          .eq('state', stateParam)
          .is('consumed_at', null);
        if (!consumeErr && (count ?? 0) > 0) stateOk = true;
      }
      if (!stateOk) {
        console.warn('[LINE-CB-FN] state invalid: missing/expired/consumed nonce row');
      }
    }

    if (!stateOk) {
      const fallbackSite = Deno.env.get('SITE_URL') || 'https://wise-traders-hub.lovable.app';
      return new Response(null, {
        status: 302,
        headers: { Location: `${fallbackSite}/holding-checkup?line_error=invalid_state` },
      });
    }


    const safeReturnTo = returnTo.startsWith('/') ? returnTo : '/holding-checkup';

    // Open Redirect protection: whitelist allowed origins
    const ALLOWED_ORIGINS = [
      'https://wise-traders-hub.lovable.app',
      'https://id-preview--0f5bdae6-cb07-4e2a-88dc-334c90cb5b02.lovable.app',
      'https://legendflow.tw',
      'https://www.legendflow.tw',
    ];
    const fallbackSiteUrl = Deno.env.get('SITE_URL') || 'https://wise-traders-hub.lovable.app';
    let siteUrl = fallbackSiteUrl;
    if (appOrigin && ALLOWED_ORIGINS.includes(appOrigin)) {
      siteUrl = appOrigin;
    } else if (appOrigin) {
      console.warn('[LINE-CB-FN] Rejected untrusted app_origin:', appOrigin);
    }
    console.log('[LINE-CB-FN] Resolved siteUrl:', siteUrl, 'safeReturnTo:', safeReturnTo);

    if (error || !code) {
      return new Response(null, {
        status: 302,
        headers: { Location: `${siteUrl}${safeReturnTo}?line_error=${error || 'no_code'}` },
      });
    }

    // Exchange code for access token
    const callbackUrl = redirectUri || `${url.origin}/line-login-callback`;
    const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
      signal: AbortSignal.timeout(10000),
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
      return new Response(null, {
        status: 302,
        headers: { Location: `${siteUrl}${safeReturnTo}?line_error=token_exchange_failed` },
      });
    }

    const tokenData = await tokenRes.json();

    // Get LINE profile
    const profileRes = await fetch('https://api.line.me/v2/profile', {
      signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileRes.json();
    const lineUserId = profile.userId;
    const displayName = profile.displayName || 'LINE User';
    const pictureUrl = profile.pictureUrl || null;

    // supabaseAdmin already created above for state lookup

    // Check if there's already a profile with this line_user_id
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('user_id')
      .eq('line_user_id', lineUserId)
      .maybeSingle();

    let userId: string;
    let email = `line_${lineUserId}@line.local`;

    if (existingProfile) {
      userId = existingProfile.user_id;
    } else {
      const password = crypto.randomUUID();
      const userMetadata = {
        name: displayName,
        avatar_url: pictureUrl,
        provider: 'line',
        line_user_id: lineUserId,
      };

      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: userMetadata,
      });

      if (!createError && newUser?.user) {
        userId = newUser.user.id;
      } else {
        const errMsg = (createError?.message || '').toLowerCase();
        const errCode = (createError as { code?: string })?.code;
        const isEmailConflict =
          errCode === 'email_exists' ||
          errCode === 'user_already_exists' ||
          errMsg.includes('already been registered') ||
          errMsg.includes('already exists') ||
          errMsg.includes('email_exists');

        if (!isEmailConflict) {
          console.error('Failed to create user:', createError);
          return new Response(null, {
            status: 302,
            headers: { Location: `${siteUrl}${safeReturnTo}?line_error=signup_failed` },
          });
        }

        let existingAuthUserId: string | null = null;
        for (let page = 1; page <= 20; page++) {
          const { data: listData, error: listError } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
          if (listError) {
            console.error('[LINE-CB-FN] listUsers error:', listError);
            break;
          }
          const match = listData.users.find((u: { email?: string | null; id: string }) => u.email === email);
          if (match) {
            existingAuthUserId = match.id;
            break;
          }
          if (listData.users.length < 1000) break;
        }

        if (!existingAuthUserId) {
          console.error('[LINE-CB-FN] Email conflict but user not found via listUsers; original error:', createError);
          return new Response(null, {
            status: 302,
            headers: { Location: `${siteUrl}${safeReturnTo}?line_error=signup_failed` },
          });
        }

        userId = existingAuthUserId;
        console.log('[LINE-CB-FN] Found existing auth user by email via listUsers:', userId);
      }
    }

    // Account-merge interception: if this LINE user is a merged secondary,
    // silently redirect the login to its primary account so訂閱/持倉 all show up.
    // We need to (a) switch userId, (b) fetch primary email for the magic link,
    // (c) skip re-writing line_user_id onto the (now retired) secondary profile.
    let isMergedRedirect = false;
    try {
      const { data: mergedProf } = await supabaseAdmin
        .from('profiles')
        .select('merged_into_user_id')
        .eq('user_id', userId)
        .maybeSingle();
      if (mergedProf?.merged_into_user_id) {
        const primaryUid = mergedProf.merged_into_user_id as string;
        const { data: primaryAuth } = await supabaseAdmin.auth.admin.getUserById(primaryUid);
        const primaryEmail = primaryAuth?.user?.email;
        if (primaryEmail) {
          console.log('[LINE-CB-FN] merged secondary → primary', { from: userId, to: primaryUid });
          userId = primaryUid;
          email = primaryEmail;
          isMergedRedirect = true;

        } else {
          console.warn('[LINE-CB-FN] merged primary has no email, staying on secondary');
        }
      }
    } catch (e) {
      console.warn('[LINE-CB-FN] merged lookup failed:', (e as Error).message);
    }




    // Check if user is friends with the OA via LINE friendship API
    let isFriend = false;
    try {
      const friendRes = await fetch('https://api.line.me/friendship/v1/status', {
        signal: AbortSignal.timeout(8000),
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (friendRes.ok) {
        const friendData = await friendRes.json();
        isFriend = friendData.friendFlag === true;
      }
    } catch (e) {
      console.error('Failed to check friendship:', e);
    }

    if (isMergedRedirect) {
      // Merged secondary → primary: only refresh friendship flag on primary,
      // never overwrite line_user_id (merge already moved it) or display_name.
      const { error: friendUpdErr } = await supabaseAdmin
        .from('profiles')
        .update({ is_line_friend: isFriend, updated_at: new Date().toISOString() })
        .eq('user_id', userId);
      if (friendUpdErr) console.error('[LINE-CB-FN] merged friend update failed:', friendUpdErr);
    } else {
      const profilePayload = {
        user_id: userId,
        line_user_id: lineUserId,
        display_name: displayName,
        avatar_url: pictureUrl,
        is_line_friend: isFriend,
        updated_at: new Date().toISOString(),
      };

      const { data: existingUserProfile, error: profileLookupError } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle();

      if (profileLookupError) {
        console.error('Failed to lookup profile:', profileLookupError);
      }

      if (existingUserProfile?.id) {
        const { error: profileUpdateError } = await supabaseAdmin
          .from('profiles')
          .update({
            line_user_id: lineUserId,
            display_name: displayName,
            avatar_url: pictureUrl,
            is_line_friend: isFriend,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingUserProfile.id);

        if (profileUpdateError) {
          console.error('Failed to update profile:', profileUpdateError);
        }
      } else {
        const { error: profileInsertError } = await supabaseAdmin
          .from('profiles')
          .insert(profilePayload);

        if (profileInsertError) {
          console.error('Failed to create profile:', profileInsertError);
        }
      }
    }


    // Auto-reconcile free-tier checkup quota for this LINE user. If the user
    // was charged a usage row but no analysis result was ever stored
    // (e.g. mid-flow crash), refund the row so the free analysis is usable.
    // Fire-and-forget: never block the login redirect on this.
    try {
      const rec = await supabaseAdmin.rpc('reconcile_line_free_quota', { _user_id: userId });
      if (rec.error) {
        console.warn('[LINE-CB-FN] reconcile_line_free_quota error:', rec.error.message);
      } else {
        console.log('[LINE-CB-FN] reconcile_line_free_quota:', JSON.stringify(rec.data));
      }
    } catch (e) {
      console.warn('[LINE-CB-FN] reconcile_line_free_quota threw:', (e as Error).message);
    }



    // Generate a magic link, then consume it server-side to obtain durable
    // access_token + refresh_token. Storing those behind a one-time nonce
    // prevents IAB / iOS link-preview pre-fetches from killing the user's
    // session (the previous flow exposed a single-use OTP to the client).
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: {
        redirectTo: `${siteUrl}/auth/line-callback`,
      },
    });

    if (linkError || !linkData?.properties?.action_link) {
      console.error('[LINE-CB-FN] generateLink failed:', linkError);
      return new Response(null, {
        status: 302,
        headers: { Location: `${siteUrl}${safeReturnTo}?line_error=session_failed` },
      });
    }

    // Server-side follow the magic link with redirect:'manual' to capture
    // the Supabase auth redirect whose URL fragment contains the tokens.
    let accessToken: string | null = null;
    let refreshToken: string | null = null;
    try {
      const verifyRes = await fetch(linkData.properties.action_link, { redirect: 'manual' });
      const loc = verifyRes.headers.get('Location') || verifyRes.headers.get('location');
      if (loc) {
        // Tokens are in the URL fragment: ...#access_token=...&refresh_token=...
        const hashIdx = loc.indexOf('#');
        if (hashIdx >= 0) {
          const frag = new URLSearchParams(loc.slice(hashIdx + 1));
          accessToken = frag.get('access_token');
          refreshToken = frag.get('refresh_token');
        }
      }
    } catch (e) {
      console.error('[LINE-CB-FN] follow magic link failed:', (e as Error).message);
    }

    if (!accessToken || !refreshToken) {
      console.error('[LINE-CB-FN] could not extract tokens from magic link redirect');
      return new Response(null, {
        status: 302,
        headers: { Location: `${siteUrl}${safeReturnTo}?line_error=session_failed` },
      });
    }

    // Persist nonce (60s TTL). Single-use; client exchanges via line-login-exchange-nonce.
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const { data: nonceRow, error: nonceError } = await supabaseAdmin
      .from('line_login_nonces')
      .insert({
        user_id: userId,
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: expiresAt,
      })
      .select('nonce')
      .single();

    if (nonceError || !nonceRow?.nonce) {
      console.error('[LINE-CB-FN] nonce insert failed:', nonceError);
      return new Response(null, {
        status: 302,
        headers: { Location: `${siteUrl}${safeReturnTo}?line_error=session_failed` },
      });
    }

    const params = new URLSearchParams({
      nonce: nonceRow.nonce as string,
      return_to: safeReturnTo,
    });

    const finalUrl = `${siteUrl}/auth/line-callback?${params.toString()}`;
    console.log('[LINE-CB-FN] ✅ Final redirect (nonce flow):', finalUrl);

    return new Response(null, {
      status: 302,
      headers: { Location: finalUrl },
    });
  } catch (error) {
    console.error('LINE callback error:', error);
    const siteUrl = Deno.env.get('SITE_URL') || 'https://wise-traders-hub.lovable.app';
    return new Response(null, {
      status: 302,
      headers: { Location: `${siteUrl}/holding-checkup?line_error=internal` },
    });
  }
}));

