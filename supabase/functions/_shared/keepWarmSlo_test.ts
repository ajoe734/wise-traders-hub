// Phase I — Keep-warm SLO 純邏輯測試（先寫紅燈）
import { assertEquals } from 'jsr:@std/assert';
import {
  evaluateWaveSlo,
  evaluateAllWaveSlo,
  LATE_WARN_MIN,
  LATE_CRIT_MIN,
} from './keepWarmSlo.ts';

const now = new Date('2026-07-27T12:00:00Z').getTime();
const iso = (offsetMin: number) => new Date(now - offsetMin * 60_000).toISOString();

Deno.test('missing wave → critical', () => {
  const d = evaluateWaveSlo(1, [], now, 240);
  assertEquals(d.triggered, true);
  assertEquals(d.level, 'critical');
  assertEquals(d.reason, 'missing');
});

Deno.test('fresh ok run → not triggered', () => {
  const d = evaluateWaveSlo(1,
    [{ wave: 1, started_at: iso(10), status: 'ok' }], now, 240);
  assertEquals(d.triggered, false);
});

Deno.test('late by 40 min → warning', () => {
  // expectedInterval=240; ageMin = 240+40 = 280 → lateBy=40 → warning
  const d = evaluateWaveSlo(1,
    [{ wave: 1, started_at: iso(280), status: 'ok' }], now, 240);
  assertEquals(d.triggered, true);
  assertEquals(d.level, 'warning');
  assertEquals(d.reason, 'late');
});

Deno.test('late by 150 min → critical', () => {
  const d = evaluateWaveSlo(1,
    [{ wave: 1, started_at: iso(240 + 150), status: 'ok' }], now, 240);
  assertEquals(d.triggered, true);
  assertEquals(d.level, 'critical');
  assertEquals(d.reason, 'late');
});

Deno.test('2 consecutive non-ok → critical', () => {
  const d = evaluateWaveSlo(2, [
    { wave: 2, started_at: iso(5), status: 'error' },
    { wave: 2, started_at: iso(30), status: 'skipped_dry_run' },
    { wave: 2, started_at: iso(300), status: 'ok' },
  ], now, 240);
  assertEquals(d.triggered, true);
  assertEquals(d.level, 'critical');
  assertEquals(d.reason, 'consecutive_failed');
});

Deno.test('evaluateAllWaveSlo aggregates 3 waves', () => {
  const rows = [
    { wave: 1, started_at: iso(10), status: 'ok' },
    { wave: 3, started_at: iso(500), status: 'ok' }, // wave 3 late
  ];
  const decisions = evaluateAllWaveSlo(rows, now, { 1: 240, 2: 240, 3: 240 });
  assertEquals(decisions.length, 3);
  const w2 = decisions.find((d) => d.wave === 2)!;
  assertEquals(w2.reason, 'missing');
  const w3 = decisions.find((d) => d.wave === 3)!;
  assertEquals(w3.reason, 'late');
  const w1 = decisions.find((d) => d.wave === 1)!;
  assertEquals(w1.triggered, false);
});

Deno.test('constants sanity', () => {
  assertEquals(LATE_WARN_MIN, 30);
  assertEquals(LATE_CRIT_MIN, 120);
});
