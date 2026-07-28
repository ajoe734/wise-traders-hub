// supabase/functions/_shared/authFailureSpike_test.ts
//
// Deno test: authFailureSpike pure decision logic.
// Run: deno test supabase/functions/_shared/authFailureSpike_test.ts

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  DEFAULT_SPIKE_THRESHOLDS,
  evaluateSpikes,
  type AuthEventRow,
} from './authFailureSpike.ts';

function row(fn: string, outcome: number, code: string, cls = 'user'): AuthEventRow {
  return { fn_name: fn, auth_class: cls, outcome, code, created_at: new Date().toISOString() };
}

Deno.test('evaluateSpikes: below warn threshold → no trigger', () => {
  const rows = Array.from({ length: 5 }, () => row('checkup-analyze', 401, 'UNAUTHENTICATED'));
  const [d] = evaluateSpikes(rows);
  assertEquals(d.triggered, false);
  assertEquals(d.level, null);
  assertEquals(d.total, 5);
});

Deno.test('evaluateSpikes: warn threshold (>=10) → warning', () => {
  const rows = Array.from({ length: 12 }, () => row('checkup-analyze', 401, 'UNAUTHENTICATED'));
  const [d] = evaluateSpikes(rows);
  assertEquals(d.triggered, true);
  assertEquals(d.level, 'warning');
  assertEquals(d.total, 12);
});

Deno.test('evaluateSpikes: critical threshold (>=30) → critical', () => {
  const rows = Array.from({ length: 35 }, () => row('alerts-watchdog', 403, 'FORBIDDEN_CRON', 'cron'));
  const [d] = evaluateSpikes(rows);
  assertEquals(d.level, 'critical');
  assertEquals(d.auth_class, 'cron');
  assertEquals(d.outcome_breakdown['403:FORBIDDEN_CRON'], 35);
});

Deno.test('evaluateSpikes: ignores 2xx rows', () => {
  const rows = [
    ...Array.from({ length: 20 }, () => row('data-upsert', 200, 'OK')),
    ...Array.from({ length: 3 }, () => row('data-upsert', 401, 'UNAUTHENTICATED')),
  ];
  const decisions = evaluateSpikes(rows);
  assertEquals(decisions.length, 1);
  assertEquals(decisions[0].total, 3);
  assertEquals(decisions[0].triggered, false);
});

Deno.test('evaluateSpikes: groups by fn_name and sorts most severe first', () => {
  const rows = [
    ...Array.from({ length: 8 }, () => row('a', 401, 'UNAUTHENTICATED')),
    ...Array.from({ length: 40 }, () => row('b', 403, 'FORBIDDEN_CRON', 'cron')),
    ...Array.from({ length: 15 }, () => row('c', 401, 'UNAUTHENTICATED')),
  ];
  const decisions = evaluateSpikes(rows);
  assertEquals(decisions.map((d) => d.fn_name), ['b', 'c', 'a']);
  assertEquals(decisions[0].level, 'critical');
  assertEquals(decisions[1].level, 'warning');
  assertEquals(decisions[2].level, null);
});

Deno.test('evaluateSpikes: honors custom thresholds', () => {
  const rows = Array.from({ length: 6 }, () => row('x', 401, 'UNAUTHENTICATED'));
  const [d] = evaluateSpikes(rows, { warnMin: 5, criticalMin: 100, windowMin: 5 });
  assertEquals(d.level, 'warning');
  assertEquals(d.reason?.includes('5 分鐘'), true);
});

Deno.test('evaluateSpikes: default thresholds exported', () => {
  assertEquals(DEFAULT_SPIKE_THRESHOLDS.warnMin, 10);
  assertEquals(DEFAULT_SPIKE_THRESHOLDS.criticalMin, 30);
  assertEquals(DEFAULT_SPIKE_THRESHOLDS.windowMin, 15);
});
