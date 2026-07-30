// supabase/functions/_shared/adminGuard.ts
//
// Single source of truth for the `company_admin` caller contract.
//
// Before this module existed, 20+ edge functions each rolled their own admin
// check with four incompatible mechanisms and eight different error shapes:
//
//   - `admin.rpc('has_role', ...)` with service role
//   - `callerClient.rpc('has_role', ...)` with the caller's JWT
//   - `.from('user_roles').select('role').eq('role','company_admin')`
//   - raw `fetch(`${SUPABASE_URL}/rest/v1/rpc/has_role`)`
//
//   ...returning `{error:'forbidden'}`, `{error:'FORBIDDEN'}`,
//   `{error:'Forbidden'}`, `{error:'Forbidden: company_admin only'}`,
//   `{error:'Forbidden', reason:'not_company_admin'}`, etc.
//
// Every admin-gated function must now open with `requireCompanyAdmin(req)` and
// convert failures through `authErrorResponse(err, req)`. The auditor
// (`scripts/audit-admin-contract.mjs`) fails CI when an ad-hoc check reappears.
//
// Canonical shapes:
//   401 → { code: 'UNAUTHENTICATED',  error: 'UNAUTHENTICATED',  message, errorId }
//   403 → { code: 'FORBIDDEN_ADMIN',  error: 'FORBIDDEN_ADMIN',  message, errorId }
//   500 → { code: 'ROLE_CHECK_FAILED',error: 'ROLE_CHECK_FAILED',message, errorId }

import { AuthError, recordAuthEvent, requireCaller } from './authGuard.ts';
import { serviceClient } from './supabaseClients.ts';
import { errorResponse } from './cors.ts';

export const ADMIN_ROLE = 'company_admin';
export const FORBIDDEN_ADMIN = 'FORBIDDEN_ADMIN';
export const ROLE_CHECK_FAILED = 'ROLE_CHECK_FAILED';
export const ADMIN_FORBIDDEN_MESSAGE = '權限不足，僅公司管理員可存取';

/** Minimal surface we need from a Supabase client for role checks. */
export interface RoleCheckClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

/**
 * Role check against an injected client. Exported for tests; production code
 * should call `isCompanyAdmin` / `requireCompanyAdmin`.
 *
 * Always uses the `has_role` security-definer RPC — never a direct
 * `user_roles` select, which silently returns empty under RLS for anyone but
 * the row owner and therefore produced false "forbidden" results.
 */
export async function isCompanyAdminWith(
  client: RoleCheckClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await client.rpc('has_role', {
    _user_id: userId,
    _role: ADMIN_ROLE,
  });
  if (error) {
    const message = (error as { message?: string })?.message ?? 'has_role rpc failed';
    throw new AuthError(500, ROLE_CHECK_FAILED, message);
  }
  return data === true;
}

/** Is this user id a company admin? Uses the service role client. */
export function isCompanyAdmin(userId: string): Promise<boolean> {
  return isCompanyAdminWith(serviceClient() as unknown as RoleCheckClient, userId);
}

/**
 * Assert the caller holds `company_admin`.
 * @returns the caller's auth user id
 * @throws AuthError 401 (no/expired JWT), 403 (not admin), 500 (role lookup failed)
 */
export async function requireCompanyAdmin(req: Request): Promise<string> {
  const userId = await requireCaller(req); // throws AuthError(401)
  const ok = await isCompanyAdmin(userId);
  if (!ok) {
    const err = new AuthError(403, FORBIDDEN_ADMIN, ADMIN_FORBIDDEN_MESSAGE);
    recordAuthEvent({ req, authClass: 'user', outcome: 403, code: err.code, reason: err.message });
    throw err;
  }
  return userId;
}

export interface OwnerOrAdmin {
  userId: string;
  isAdmin: boolean;
  isOwner: boolean;
}

/**
 * Assert the caller either owns `expertId` or holds `company_admin`.
 * Used by the expert-ai family, line-push-signal and publish flows, which all
 * previously hand-rolled the same owner-OR-admin branch with different codes.
 */
export async function requireExpertOwnerOrAdmin(
  req: Request,
  expertId: string,
): Promise<OwnerOrAdmin> {
  const userId = await requireCaller(req);
  const admin = serviceClient();

  const [{ data: expert }, isAdmin] = await Promise.all([
    admin.from('experts').select('user_id').eq('id', expertId).maybeSingle(),
    isCompanyAdmin(userId),
  ]);

  const isOwner = !!expert && expert.user_id === userId;
  if (!isOwner && !isAdmin) {
    const err = new AuthError(403, FORBIDDEN_ADMIN, '權限不足，僅該專家本人或公司管理員可存取');
    recordAuthEvent({ req, authClass: 'user', outcome: 403, code: err.code, reason: err.message });
    throw err;
  }
  return { userId, isAdmin, isOwner };
}

/**
 * All company admin user ids — the one blessed way to fan out admin
 * notifications (weekly-journal-export, notify-backtest-result,
 * alerts-watchdog all had their own copy of this query).
 */
export async function listCompanyAdminIds(): Promise<string[]> {
  const admin = serviceClient();
  const { data, error } = await admin
    .from('user_roles')
    .select('user_id')
    .eq('role', ADMIN_ROLE);
  if (error) throw new AuthError(500, ROLE_CHECK_FAILED, error.message);
  return (data ?? []).map((r: { user_id: string }) => r.user_id);
}

/**
 * Convert any thrown error into the canonical response shape.
 * AuthError keeps its status/code; anything else becomes a 500 INTERNAL_ERROR.
 */
export function authErrorResponse(err: unknown, req?: Request): Response {
  if (err instanceof AuthError) {
    return errorResponse(err.message, err.status, { code: err.code }, req);
  }
  const message = err instanceof Error ? err.message : String(err);
  return errorResponse(message, 500, { code: 'INTERNAL_ERROR' }, req);
}
