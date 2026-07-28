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

import { getCallerUserId } from './supabaseClients.ts';

export class AuthError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Ensure the request carries a valid Supabase user JWT.
 * Returns the caller's user id, or throws AuthError(401).
 */
export async function requireCaller(req: Request): Promise<string> {
  const auth = req.headers.get('Authorization') ?? req.headers.get('authorization');
  if (!auth || !auth.toLowerCase().startsWith('bearer ')) {
    throw new AuthError(401, 'UNAUTHENTICATED', 'Missing Authorization bearer token');
  }
  const userId = await getCallerUserId(req);
  if (!userId) {
    throw new AuthError(401, 'UNAUTHENTICATED', 'Invalid or expired session');
  }
  return userId;
}

/**
 * Ensure the request comes from our scheduler.
 * Requires header `X-Cron-Key` matching env `CRON_SHARED_SECRET`.
 * Throws AuthError(403) on mismatch or when the secret is not configured.
 */
export function requireCronKey(req: Request): void {
  const expected = Deno.env.get('CRON_SHARED_SECRET') ?? '';
  if (!expected) {
    throw new AuthError(503, 'CRON_SECRET_MISSING', 'CRON_SHARED_SECRET not configured');
  }
  const provided = req.headers.get('x-cron-key') ?? req.headers.get('X-Cron-Key') ?? '';
  if (provided !== expected) {
    throw new AuthError(403, 'FORBIDDEN_CRON', 'Invalid or missing X-Cron-Key');
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
