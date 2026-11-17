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
