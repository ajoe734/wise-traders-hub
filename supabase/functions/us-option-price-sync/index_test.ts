// Phase 1 — TDD for US option snapshot function.
// These tests focus on pure logic (no network / no Supabase mocks):
//   - OCC symbol construction (mirrors src/lib/optionCombo.ts)
//   - Yahoo payload parsing (mark price, bid/ask/last fallback)
//   - NY post-close window classifier (used to dedupe EDT vs EST cron)
import {
  assertEquals,
  assert,
  assertAlmostEquals,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { buildOccSymbol } from './occ.ts';
import { parseYahooOptionPayload } from './yahoo.ts';
import { isPostCloseNY, nyClock } from './index.ts';

Deno.test('OCC symbol: SNDK 2026-01-16 950P', () => {
  assertEquals(
    buildOccSymbol({ underlying: 'SNDK', expiry: '2026-01-16', right: 'P', strike: 950 }),
    'SNDK260116P00950000',
  );
});

Deno.test('OCC symbol: handles non-integer strike (10.5)', () => {
  assertEquals(
    buildOccSymbol({ underlying: 'AAPL', expiry: '2025-12-19', right: 'C', strike: 10.5 }),
    'AAPL251219C00010500',
  );
});

Deno.test('OCC symbol: empty on bad expiry', () => {
  assertEquals(
    buildOccSymbol({ underlying: 'AAPL', expiry: '20251219', right: 'C', strike: 10 }),
    '',
  );
});

Deno.test('Yahoo parse: bid/ask midpoint wins over last', () => {
  const payload = {
    optionChain: {
      result: [{
        options: [{
          calls: [{ contractSymbol: 'AAPL251219C00100000', bid: 2.0, ask: 2.1, lastPrice: 1.5, volume: 42, change: 0.1 }],
          puts: [],
        }],
      }],
    },
  };
  const chain = parseYahooOptionPayload(payload, 'AAPL', '2025-12-19');
  const q = chain.byOcc.get('AAPL251219C00100000');
  assert(q);
  assertAlmostEquals(q!.mark, 2.05, 1e-9);
  assertEquals(q!.volume, 42);
  assertAlmostEquals(q!.yesterday_close!, 1.4, 1e-9);
});

Deno.test('Yahoo parse: falls back to lastPrice when bid/ask are 0', () => {
  const payload = {
    optionChain: {
      result: [{
        options: [{
          calls: [],
          puts: [{ contractSymbol: 'RKLB260116P00047500', bid: 0, ask: 0, lastPrice: 1.75, volume: 10 }],
        }],
      }],
    },
  };
  const chain = parseYahooOptionPayload(payload, 'RKLB', '2026-01-16');
  const q = chain.byOcc.get('RKLB260116P00047500');
  assert(q);
  assertAlmostEquals(q!.mark, 1.75, 1e-9);
});

Deno.test('Yahoo parse: drops rows with no price signal', () => {
  const payload = {
    optionChain: {
      result: [{
        options: [{
          calls: [{ contractSymbol: 'X', bid: 0, ask: 0, lastPrice: 0 }],
          puts: [],
        }],
      }],
    },
  };
  const chain = parseYahooOptionPayload(payload, 'X', '2025-01-01');
  assertEquals(chain.byOcc.size, 0);
});

Deno.test('NY post-close: weekday 16:10 within window', () => {
  assert(isPostCloseNY({ hour: 16, minute: 10, dow: 2 }));
});

Deno.test('NY post-close: weekday 15:59 rejected (too early)', () => {
  assertEquals(isPostCloseNY({ hour: 15, minute: 59, dow: 2 }), false);
});

Deno.test('NY post-close: weekend rejected regardless of hour', () => {
  assertEquals(isPostCloseNY({ hour: 16, minute: 10, dow: 6 }), false);
});

Deno.test('NY post-close: 17:00 rejected (too late)', () => {
  assertEquals(isPostCloseNY({ hour: 17, minute: 0, dow: 2 }), false);
});

Deno.test('nyClock: shape only (real DST check requires TZ data)', () => {
  const c = nyClock(new Date('2026-07-01T20:10:00Z')); // ~16:10 EDT
  assertEquals(c.hour >= 0 && c.hour < 24, true);
  assertEquals(c.dow >= 0 && c.dow <= 6, true);
});
