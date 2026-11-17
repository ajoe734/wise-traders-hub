import { assertEquals } from 'jsr:@std/assert@1';
import { mapHoldings, plaidEnv, revokeDeadline, revokeUrgency, isAlreadyRevoked } from './plaidCore.ts';

Deno.test('production is off unless explicitly set', () => {
  assertEquals(plaidEnv(undefined), 'sandbox');
  assertEquals(plaidEnv('development'), 'sandbox');
  assertEquals(plaidEnv('production'), 'production');
});

Deno.test('revoke deadline is 24h from first request and never extended', () => {
  const now = new Date('2026-11-17T00:00:00Z');
  assertEquals(revokeDeadline(null, now), '2026-11-18T00:00:00.000Z');
  assertEquals(revokeDeadline('2026-11-17T05:00:00.000Z', new Date('2026-11-17T20:00:00Z')), '2026-11-17T05:00:00.000Z');
});

Deno.test('urgency alerts 2h before deadline and when overdue', () => {
  const d = '2026-11-18T00:00:00.000Z';
  assertEquals(revokeUrgency(d, new Date('2026-11-17T12:00:00Z')), 'ok');
  assertEquals(revokeUrgency(d, new Date('2026-11-17T23:00:00Z')), 'near_deadline');
  assertEquals(revokeUrgency(d, new Date('2026-11-18T00:00:01Z')), 'overdue');
});

Deno.test('already-removed item counts as revoked, other errors retry', () => {
  assertEquals(isAlreadyRevoked('ITEM_NOT_FOUND'), true);
  assertEquals(isAlreadyRevoked('INTERNAL_SERVER_ERROR'), false);
});

Deno.test('mapHoldings drops cash and zero quantity', () => {
  const rows = mapHoldings({
    securities: [{ security_id: 'a', ticker_symbol: 'AAPL', name: 'Apple', type: 'equity' }, { security_id: 'c', type: 'cash' }],
    holdings: [{ security_id: 'a', quantity: 10, cost_basis: 1500, institution_price: 190, iso_currency_code: 'USD' },
               { security_id: 'c', quantity: 100 }, { security_id: 'a', quantity: 0 }],
  });
  assertEquals(rows.length, 1);
  assertEquals(rows[0].symbol, 'AAPL');
  assertEquals(rows[0].quantity, 10);
});

import { attemptRevokeWith, isAllowedInstitution, type RevokeDeps } from './plaidCore.ts';

function fakeStore(failCodes: (string | null)[]) {
  const st = { token: 'access-sandbox-x' as string | null, drafts: 3, attempts: 0, purged: false, alerts: [] as string[], removeCalls: 0 };
  const deps: RevokeDeps = {
    getToken: async () => st.token,
    removeItem: async () => { const c = failCodes[st.removeCalls++]; if (c) throw { code: c }; },
    deleteTokenAndDrafts: async () => { st.token = null; st.drafts = 0; },
    countTokens: async () => (st.token ? 1 : 0),
    markPurged: async () => { st.purged = true; },
    markRetry: async (_id, a) => { st.attempts = a; },
    alert: async (u) => { st.alerts.push(u); },
  };
  return { st, deps };
}

Deno.test('only Firstrade ins_120188 is allowed', () => {
  assertEquals(isAllowedInstitution('ins_120188'), true);
  assertEquals(isAllowedInstitution('ins_109508'), false);
  assertEquals(isAllowedInstitution(null), false);
});

Deno.test('revoke failure keeps token, counts attempt, retry then purges', async () => {
  const { st, deps } = fakeStore(['INTERNAL_SERVER_ERROR', null]);
  const conn = { id: 'c1', revoke_deadline_at: '2026-11-18T00:00:00.000Z', revoke_attempts: 0 };
  const r1 = await attemptRevokeWith(deps, conn, new Date('2026-11-17T01:00:00Z'));
  assertEquals(r1.status, 'retry_pending');
  assertEquals(st.token !== null, true);
  assertEquals(st.attempts, 1);
  assertEquals(st.alerts.length, 0);
  const r2 = await attemptRevokeWith(deps, { ...conn, revoke_attempts: 1 }, new Date('2026-11-17T02:00:00Z'));
  assertEquals(r2.status, 'purged');
  assertEquals(st.token, null);
  assertEquals(st.drafts, 0);
  assertEquals(st.purged, true);
});

Deno.test('revoke failing near and past deadline raises alerts, token still kept', async () => {
  const { st, deps } = fakeStore(['PLANNED_MAINTENANCE', 'PLANNED_MAINTENANCE']);
  const conn = { id: 'c1', revoke_deadline_at: '2026-11-18T00:00:00.000Z', revoke_attempts: 0 };
  await attemptRevokeWith(deps, conn, new Date('2026-11-17T23:00:00Z'));
  await attemptRevokeWith(deps, { ...conn, revoke_attempts: 1 }, new Date('2026-11-18T00:30:00Z'));
  assertEquals(st.alerts, ['near_deadline', 'overdue']);
  assertEquals(st.token !== null, true);
  assertEquals(st.purged, false);
});

Deno.test('late success is purged but flagged late (not reported compliant)', async () => {
  const { deps } = fakeStore([null]);
  const r = await attemptRevokeWith(deps, { id: 'c1', revoke_deadline_at: '2026-11-18T00:00:00.000Z' }, new Date('2026-11-18T01:00:00Z'));
  assertEquals(r, { status: 'purged', late: true });
});

import { runSyncWith, type SyncDeps } from './plaidCore.ts';

function fakeSync(opts: { blockAtWrite?: boolean; fetchFails?: string }) {
  const st = { fetched: 0, written: 0, finished: [] as string[], failed: 0, notified: 0 };
  const deps: SyncDeps = {
    getToken: async () => 'access-sandbox-x',
    fetchHoldings: async () => {
      st.fetched++;
      if (opts.fetchFails) throw { code: opts.fetchFails };
      return { securities: [{ security_id: 'a', ticker_symbol: 'EWZ', type: 'etf' }], holdings: [{ security_id: 'a', quantity: 5 }] };
    },
    replaceDrafts: async (_id, rows) => {
      if (opts.blockAtWrite) throw new Error('ERROR: plaid_sync_blocked');
      st.written += rows.length; return rows.length;
    },
    finish: async (s) => { st.finished.push(s); },
    markFailed: async () => { st.failed++; },
    notifyFailure: async () => { st.notified++; },
  };
  return { st, deps };
}

Deno.test('sync on an already-disconnected connection never fetches or writes', async () => {
  const { st, deps } = fakeSync({});
  const r = await runSyncWith(deps, { id: 'c', status: 'disconnect_requested', sync_blocked: true });
  assertEquals(r, { status: 'blocked' });
  assertEquals([st.fetched, st.written, st.notified], [0, 0, 0]);
});

Deno.test('disconnect between fetch and write: locked write refuses, run is blocked, no failure notice', async () => {
  const { st, deps } = fakeSync({ blockAtWrite: true });
  const r = await runSyncWith(deps, { id: 'c', status: 'active', sync_blocked: false });
  assertEquals(r, { status: 'blocked' });
  assertEquals([st.fetched, st.written, st.failed, st.notified], [1, 0, 0, 0]);
  assertEquals(st.finished, ['blocked']);
});

Deno.test('upstream failure is recorded and notified; success writes drafts', async () => {
  const f = fakeSync({ fetchFails: 'ITEM_LOGIN_REQUIRED' });
  assertEquals(await runSyncWith(f.deps, { id: 'c', status: 'active', sync_blocked: false }), { status: 'failed', error_code: 'ITEM_LOGIN_REQUIRED' });
  assertEquals([f.st.failed, f.st.notified], [1, 1]);
  const ok = fakeSync({});
  assertEquals(await runSyncWith(ok.deps, { id: 'c', status: 'active', sync_blocked: false }), { status: 'ok', holdings_count: 1 });
});
