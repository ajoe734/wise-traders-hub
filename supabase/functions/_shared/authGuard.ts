// supabase/functions/_shared/authGuard.ts
//
// Unified auth guards for edge functions.
//
// Every edge function with `verify_jwt = false` must open with ONE of:
//   - `await requireCaller(req)`   → user-triggered endpoint (401 on missing/bad JWT)
//   - `requireCronKey(req)`        → scheduler-only endpoint (403 without X-Cron-Key)
//   - `// AUTH: webhook-signature` → provider webhook (verified via provider-specific verifier
//                                     later in the handler, e.g. ECPay CheckMacValue)
//
// The static auditor (`scripts/audit-edge-fn-auth.mjs`) grep's for exactly these markers.
// Do NOT rename them without updating the auditor.
//
// Phase M-3a: guards emit a fire-and-forget event into
// `public.edge_function_auth_events` on any 401/403/503 failure so
// `alerts-watchdog` can raise spike alerts. Logging never blocks or throws.

import { getCallerUserId, serviceClient } from './supabaseClients.ts';

export class AuthError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type AuthClass = 'user' | 'cron' | 'webhook' | 'public' | 'unknown';

function extractFnName(req: Request): string {
  try {
    const p = new URL(req.url).pathname;
    // Supabase functions runtime paths look like /<fn>/... or /functions/v1/<fn>/...
    const parts = p.split('/').filter(Boolean);
    if (parts[0] === 'functions' && parts[1] === 'v1' && parts[2]) return parts[2];
    if (parts[0]) return parts[0];
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

function extractCallerIp(req: Request): string | null {
  const xf = req.headers.get('x-forwarded-for');
  if (xf) return xf.split(',')[0].trim();
  return req.headers.get('cf-connecting-ip')
    ?? req.headers.get('x-real-ip')
    ?? null;
}

function extractCorrelationId(req: Request): string | null {
  return req.headers.get('x-correlation-id')
    ?? req.headers.get('x-request-id')
    ?? null;
}

/**
 * Fire-and-forget insert into edge_function_auth_events.
 * Never throws, never awaits meaningfully (returned promise ignored).
 */
export function recordAuthEvent(input: {
  req: Request;
  fnName?: string;
  authClass: AuthClass;
  outcome: number;
  code?: string | null;
  reason?: string | null;
}): void {
  // Disable logging in test/local runs by setting AUTH_EVENT_LOGGING=0
  if (Deno.env.get('AUTH_EVENT_LOGGING') === '0') return;
  try {
    const admin = serviceClient();
    const row = {
      fn_name: input.fnName ?? extractFnName(input.req),
      auth_class: input.authClass,
      outcome: input.outcome,
      code: input.code ?? null,
      reason: input.reason ?? null,
      caller_ip: extractCallerIp(input.req),
      correlation_id: extractCorrelationId(input.req),
    };
    admin.from('edge_function_auth_events').insert(row).then(() => {}).catch(() => {});
  } catch {
    // never surface logging failures to callers
  }
}

/**
 * Ensure the request carries a valid Supabase user JWT.
 * Returns the caller's user id, or throws AuthError(401).
 */
export async function requireCaller(req: Request): Promise<string> {
  const auth = req.headers.get('Authorization') ?? req.headers.get('authorization');
  if (!auth || !auth.toLowerCase().startsWith('bearer ')) {
    const err = new AuthError(401, 'UNAUTHENTICATED', 'Missing Authorization bearer token');
    recordAuthEvent({ req, authClass: 'user', outcome: 401, code: err.code, reason: err.message });
    throw err;
  }
  const userId = await getCallerUserId(req);
  if (!userId) {
    const err = new AuthError(401, 'UNAUTHENTICATED', 'Invalid or expired session');
    recordAuthEvent({ req, authClass: 'user', outcome: 401, code: err.code, reason: err.message });
    throw err;
  }
  return userId;
}

/**
 * Ensure the request comes from our scheduler.
 * Requires header `X-Cron-Key` matching env `CRON_SHARED_SECRET`.
 * Throws AuthError(403) on mismatch or 503 when the secret is not configured.
 */
export function requireCronKey(req: Request): void {
  const expected = Deno.env.get('CRON_SHARED_SECRET') ?? '';
  if (!expected) {
    const err = new AuthError(503, 'CRON_SECRET_MISSING', 'CRON_SHARED_SECRET not configured');
    recordAuthEvent({ req, authClass: 'cron', outcome: 503, code: err.code, reason: err.message });
    throw err;
  }
  const provided = req.headers.get('x-cron-key') ?? req.headers.get('X-Cron-Key') ?? '';
  if (provided !== expected) {
    const err = new AuthError(403, 'FORBIDDEN_CRON', 'Invalid or missing X-Cron-Key');
    recordAuthEvent({ req, authClass: 'cron', outcome: 403, code: err.code, reason: err.message });
    throw err;
  }
}

/**
 * Marker helper for webhook endpoints. Call this at the top of a webhook
 * handler purely for auditor recognition; the real verification happens via
 * provider-specific signature checks (ECPay CheckMacValue, LINE signature,
 * ACpay MAC, etc.). The auditor also accepts the literal comment
 * `// AUTH: webhook-signature` as an equivalent marker.
 */
export function markWebhook(_provider: string): void {
  /* auditor marker only */
}

/**
 * Convenience wrapper for webhook handlers to log signature failures.
 * Webhooks should call this in their catch/verify path when a signature
 * check fails, so spike detection covers webhook forgery attempts too.
 */
export function recordWebhookRejection(req: Request, provider: string, reason: string): void {
  recordAuthEvent({
    req,
    authClass: 'webhook',
    outcome: 401,
    code: `WEBHOOK_${provider.toUpperCase()}_REJECTED`,
    reason,
  });
}
