// Deno tests for the unified company_admin caller contract.
import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  ADMIN_FORBIDDEN_MESSAGE,
  ADMIN_ROLE,
  FORBIDDEN_ADMIN,
  ROLE_CHECK_FAILED,
  authErrorResponse,
  isCompanyAdminWith,
} from './adminGuard.ts';
import { AuthError } from './authGuard.ts';

Deno.env.set('AUTH_EVENT_LOGGING', '0');

function fakeClient(result: { data?: unknown; error?: unknown }, calls: unknown[] = []) {
  return {
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
    },
  };
}

Deno.test('isCompanyAdminWith calls has_role with the canonical role name', async () => {
  const calls: unknown[] = [];
  const ok = await isCompanyAdminWith(fakeClient({ data: true }, calls), 'u-1');
  assertEquals(ok, true);
  assertEquals(calls, [{ fn: 'has_role', args: { _user_id: 'u-1', _role: ADMIN_ROLE } }]);
});

Deno.test('isCompanyAdminWith is strict about truthiness', async () => {
  assertEquals(await isCompanyAdminWith(fakeClient({ data: false }), 'u'), false);
  assertEquals(await isCompanyAdminWith(fakeClient({ data: null }), 'u'), false);
  assertEquals(await isCompanyAdminWith(fakeClient({ data: 'true' }), 'u'), false);
});

Deno.test('isCompanyAdminWith surfaces lookup failure as 500, not 403', async () => {
  const err = await assertRejects(
    () => isCompanyAdminWith(fakeClient({ error: { message: 'boom' } }), 'u'),
    AuthError,
  );
  assertEquals(err.status, 500);
  assertEquals(err.code, ROLE_CHECK_FAILED);
});

Deno.test('authErrorResponse renders the canonical 403 shape', async () => {
  const res = authErrorResponse(new AuthError(403, FORBIDDEN_ADMIN, ADMIN_FORBIDDEN_MESSAGE));
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.code, FORBIDDEN_ADMIN);
  assertEquals(body.error, FORBIDDEN_ADMIN);
  assertEquals(body.message, ADMIN_FORBIDDEN_MESSAGE);
  assertEquals(typeof body.errorId, 'string');
});

Deno.test('authErrorResponse renders the canonical 401 shape', async () => {
  const res = authErrorResponse(new AuthError(401, 'UNAUTHENTICATED', 'Invalid or expired session'));
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.code, 'UNAUTHENTICATED');
  assertEquals(body.error, 'UNAUTHENTICATED');
});

Deno.test('authErrorResponse downgrades unknown errors to 500 INTERNAL_ERROR', async () => {
  const res = authErrorResponse(new Error('kaboom'));
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.code, 'INTERNAL_ERROR');
  assertEquals(body.message, 'kaboom');
});

Deno.test('authErrorResponse always sets CORS + json content type', () => {
  const res = authErrorResponse(new AuthError(403, FORBIDDEN_ADMIN, ADMIN_FORBIDDEN_MESSAGE));
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
  assertEquals(res.headers.get('Content-Type'), 'application/json');
});
