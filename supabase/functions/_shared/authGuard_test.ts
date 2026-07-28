// Deno test: authGuard.
//
// Run:  deno test supabase/functions/_shared/authGuard_test.ts --allow-env --allow-net
//
// We stub `getCallerUserId` by monkey-patching the module namespace via a
// small dependency injection: tests set `globalThis.__TEST_CALLER_ID__` and
// re-import a thin wrapper. To keep the test hermetic we test the header
// parsing / cron branch directly, and validate 401 mapping for missing
// bearer without hitting Supabase.

import { assertEquals, assertRejects, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { AuthError, requireCaller, requireCronKey } from './authGuard.ts';

Deno.test('requireCaller: missing Authorization → 401', async () => {
  const req = new Request('http://x', { method: 'POST' });
  await assertRejects(
    () => requireCaller(req),
    AuthError,
    'Missing Authorization',
  );
});

Deno.test('requireCaller: non-bearer scheme → 401', async () => {
  const req = new Request('http://x', {
    method: 'POST',
    headers: { Authorization: 'Basic abc' },
  });
  await assertRejects(
    () => requireCaller(req),
    AuthError,
    'Missing Authorization',
  );
});

Deno.test('requireCronKey: matching header passes', () => {
  Deno.env.set('CRON_SHARED_SECRET', 'sekret-1');
  const req = new Request('http://x', { headers: { 'x-cron-key': 'sekret-1' } });
  requireCronKey(req); // no throw
});

Deno.test('requireCronKey: mismatched header → 403', () => {
  Deno.env.set('CRON_SHARED_SECRET', 'sekret-1');
  const req = new Request('http://x', { headers: { 'x-cron-key': 'wrong' } });
  const err = assertThrows(() => requireCronKey(req), AuthError);
  assertEquals(err.status, 403);
  assertEquals(err.code, 'FORBIDDEN_CRON');
});

Deno.test('requireCronKey: missing secret env → 503', () => {
  Deno.env.delete('CRON_SHARED_SECRET');
  const req = new Request('http://x', { headers: { 'x-cron-key': 'anything' } });
  const err = assertThrows(() => requireCronKey(req), AuthError);
  assertEquals(err.status, 503);
  assertEquals(err.code, 'CRON_SECRET_MISSING');
});
