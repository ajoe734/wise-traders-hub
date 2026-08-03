// AUTH: public  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// Exchange a one-time LINE login nonce for a real Supabase session.
//
// Why this exists:
//   The previous flow handed the client a `token_hash` magic link OTP.
//   That OTP is single-use, so any LINE in-app browser / iOS link preview
//   that pre-fetched the URL would consume it before the real user click,
//   causing "登入驗證失敗，請重試".
//
//   Instead, line-login-callback now stores access_token + refresh_token
//   in `line_login_nonces` keyed by a short-lived UUID. The client POSTs
//   the nonce here, we atomically delete the row (so a second call 410s),
//   and return the durable session tokens for `supabase.auth.setSession`.

import { serviceClient } from '../_shared/supabaseClients.ts';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

import { corsHeaders } from '../_shared/cors.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
import { validateInput, validationJsonResponse } from '../_shared/inputValidator.ts';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(withLogging('line-login-exchange-nonce', async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: { nonce?: string } = {};
  try { body = await req.json(); } catch { body = {}; }
  const trimmed = (body.nonce || '').trim();
  const issues = validateInput({
    fields: { nonce: { required: true, type: 'string', label: 'nonce', pattern: UUID_RE, hint: 'UUID v4 格式' } },
    source: { nonce: trimmed },
  });
  if (issues.length) return validationJsonResponse(issues);
  const nonce = trimmed;

  const supabaseAdmin = serviceClient();

  // Atomic single-use consume: delete-and-return.
  // If row missing or already expired (we check via expires_at), no row returns.
  const { data, error } = await supabaseAdmin
    .from('line_login_nonces')
    .delete()
    .eq('nonce', nonce)
    .gt('expires_at', new Date().toISOString())
    .select('access_token, refresh_token')
    .maybeSingle();

  // 過期列清理：不論本次兌換成功或失敗都要做，否則失敗路徑會讓過期 nonce 永久殘留。
  const sweepStale = () =>
    supabaseAdmin
      .from('line_login_nonces')
      .delete()
      .lt('expires_at', new Date().toISOString())
      .then(() => {}, () => {});

  if (error) {
    console.error('[line-login-exchange-nonce] DB error:', error);
    return new Response(JSON.stringify({ error: 'internal' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!data) {
    sweepStale();
    return new Response(JSON.stringify({ error: 'nonce_expired_or_used' }), {
      status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  sweepStale();


  return new Response(JSON.stringify({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}));
