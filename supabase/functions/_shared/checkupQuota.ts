// Shared helper for consuming the Stock Dashboard (持倉看板) AI quota.
// Use it at the very start of any AI-consuming checkup edge function.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

export interface QuotaResult {
  ok: boolean;
  status?: number;
  body?: Record<string, unknown>;
  quota?: {
    tier: string;
    period: string;
    limit: number;
    used: number;
    remaining: number;
    resets_at: string;
  };
  userId?: string;
}

/**
 * Atomically consume one quota credit for the authenticated user.
 *
 * Behaviour:
 *  - 401 if no/invalid JWT
 *  - 429 if QUOTA_EXCEEDED
 *  - returns ok:true with the updated quota snapshot otherwise
 */
export async function consumeCheckupQuota(
  req: Request,
  kind: string = 'analysis',
  corsHeaders: Record<string, string> = {},
): Promise<QuotaResult> {
  const authHeader = req.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) {
    return {
      ok: false,
      status: 401,
      body: { error: 'AUTH_REQUIRED', message: '請先登入再使用 AI 功能' },
    };
  }

  // Resolve user via auth.getUser
  let userId = '';
  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${jwt}`, apikey: SERVICE_ROLE_KEY },
    });
    if (!userRes.ok) {
      return { ok: false, status: 401, body: { error: 'AUTH_INVALID' } };
    }
    const u = await userRes.json();
    userId = u?.id || '';
  } catch (err) {
    console.error('[quota] getUser failed', err);
    return { ok: false, status: 401, body: { error: 'AUTH_INVALID' } };
  }
  if (!userId) {
    return { ok: false, status: 401, body: { error: 'AUTH_INVALID' } };
  }

  // Call consume_checkup_quota RPC via service role (bypass RLS, runs SECURITY DEFINER)
  try {
    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/consume_checkup_quota`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ _user_id: userId, _kind: kind }),
    });

    if (!rpcRes.ok) {
      const text = await rpcRes.text();
      // Detect QUOTA_EXCEEDED from PG raised exception
      if (text.includes('QUOTA_EXCEEDED')) {
        // Best-effort: also fetch current snapshot for the client
        let snapshot: any = null;
        try {
          const snapRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/check_checkup_quota`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: SERVICE_ROLE_KEY,
              Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({ _user_id: userId }),
          });
          if (snapRes.ok) snapshot = await snapRes.json();
        } catch {}
        return {
          ok: false,
          status: 429,
          body: {
            error: 'QUOTA_EXCEEDED',
            message: '本期 AI 配額已用完，下期重置或升級方案後可繼續使用',
            quota: snapshot,
          },
          userId,
        };
      }
      console.error('[quota] consume RPC failed', rpcRes.status, text);
      return {
        ok: false,
        status: 500,
        body: { error: 'QUOTA_CHECK_FAILED', detail: text.slice(0, 300) },
        userId,
      };
    }

    const quota = await rpcRes.json();
    return { ok: true, quota, userId };
  } catch (err) {
    console.error('[quota] consume error', err);
    return {
      ok: false,
      status: 500,
      body: { error: 'QUOTA_CHECK_FAILED', detail: String(err) },
      userId,
    };
  }
}

/** Helper: build a Response from a non-ok QuotaResult. */
export function quotaErrorResponse(
  result: QuotaResult,
  corsHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(result.body || { error: 'QUOTA_CHECK_FAILED' }), {
    status: result.status || 500,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
