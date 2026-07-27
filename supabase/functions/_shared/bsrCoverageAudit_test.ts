// TDD for Phase L1 — BSR coverage audit.
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import {
  auditCoverage,
  classifyCoverage,
  decideCoverageAlerts,
  detectStaleSnapshots,
  MIN_SAMPLE,
  type CoverageInput,
} from './bsrCoverageAudit.ts';

// helper: `lots` 是張數（人類直覺輸入），內部換算為 shares 對齊新欄位 snapshot_volume_shares
function mk(
  stock: string,
  date: string,
  shares: number,
  lots: number | null,
  brokers = 100,
): CoverageInput {
  return {
    stock_id: stock,
    trade_date: date,
    broker_sum_shares: shares,
    broker_count: brokers,
    snapshot_volume_shares: lots == null ? null : lots * 1000,
  };
}

Deno.test('classifyCoverage: null snapshot → missing_snapshot', () => {
  const row = classifyCoverage(mk('1101', '2026-07-27', 34575401, null), new Set());
  assertEquals(row.class, 'missing_snapshot');
  assertEquals(row.coverage_pct, null);
});

Deno.test('classifyCoverage: full cover (100%) → ok', () => {
  const row = classifyCoverage(mk('2330', '2026-07-27', 21_500_000, 21500), new Set());
  assertEquals(row.class, 'ok');
  assertEquals(row.coverage_pct, 100.0);
});

Deno.test('classifyCoverage: 30% → broker_under_cover', () => {
  const row = classifyCoverage(mk('3028', '2026-07-22', 1_550_263, 4689), new Set());
  assertEquals(row.class, 'broker_under_cover');
  assertEquals(row.coverage_pct! < 60, true);
});

Deno.test('classifyCoverage: 140% → broker_over_cover', () => {
  const row = classifyCoverage(mk('2330', '2026-07-27', 30_100_000, 21500), new Set());
  assertEquals(row.class, 'broker_over_cover');
});

Deno.test('classifyCoverage: 90% → ok', () => {
  const row = classifyCoverage(mk('2317', '2026-07-22', 65_450_000 * 0.9, 65450), new Set());
  assertEquals(row.class, 'ok');
});

Deno.test('detectStaleSnapshots: 3 identical → all 3 stale', () => {
  const inputs = [
    mk('3028', '2026-07-20', 1000, 4689),
    mk('3028', '2026-07-21', 1000, 4689),
    mk('3028', '2026-07-22', 1000, 4689),
  ];
  const stale = detectStaleSnapshots(inputs);
  assertEquals(stale.size, 3);
  assertEquals(stale.has('3028|2026-07-20'), true);
});

Deno.test('detectStaleSnapshots: 2 identical → not stale', () => {
  const inputs = [
    mk('3028', '2026-07-20', 1000, 4689),
    mk('3028', '2026-07-21', 1000, 4689),
    mk('3028', '2026-07-22', 1000, 5000),
  ];
  const stale = detectStaleSnapshots(inputs);
  assertEquals(stale.size, 0);
});

Deno.test('detectStaleSnapshots: null volume ignored', () => {
  const inputs = [
    mk('1101', '2026-07-20', 1000, null),
    mk('1101', '2026-07-21', 1000, null),
    mk('1101', '2026-07-22', 1000, null),
  ];
  const stale = detectStaleSnapshots(inputs);
  assertEquals(stale.size, 0);
});

Deno.test('auditCoverage: mixed classes counted', () => {
  const inputs: CoverageInput[] = [];
  for (let i = 0; i < 5; i++) inputs.push(mk('1101', `2026-07-${20 + i}`, 1000, null));
  for (let i = 0; i < 3; i++) inputs.push(mk('3028', `2026-07-${20 + i}`, 1000, 4689)); // stale
  for (let i = 0; i < 2; i++) inputs.push(mk('2330', `2026-07-${20 + i}`, 21_500_000, 21500 + i)); // ok
  inputs.push(mk('3035', '2026-07-22', 4_881_431, 17859)); // under
  inputs.push(mk('2330', '2026-07-27', 30_100_000, 21505)); // over

  const s = auditCoverage(inputs);
  assertEquals(s.sampleSize, 12);
  assertEquals(s.missingSnapshot, 5);
  assertEquals(s.staleSnapshot, 3);
  assertEquals(s.underCover, 1);
  assertEquals(s.overCover, 1);
  assertEquals(s.ok, 2);
});

Deno.test('decideCoverageAlerts: sample too small → skip', () => {
  const inputs = Array.from({ length: MIN_SAMPLE - 1 }, (_, i) =>
    mk('X', `2026-07-${String(i + 1).padStart(2, '0')}`, 1000, null),
  );
  const s = auditCoverage(inputs);
  const d = decideCoverageAlerts(s);
  assertEquals(d[0].triggered, false);
  assertEquals(d[0].reason, 'sample_too_small');
});

Deno.test('decideCoverageAlerts: missing 40% → warning', () => {
  const inputs: CoverageInput[] = [];
  for (let i = 0; i < 8; i++) inputs.push(mk(`M${i}`, '2026-07-27', 1000, null));
  for (let i = 0; i < 12; i++) inputs.push(mk(`K${i}`, '2026-07-27', 21_500_000, 21500));
  const s = auditCoverage(inputs);
  const d = decideCoverageAlerts(s);
  const missing = d.find((x) => x.kind === 'daily_snapshot_volume_missing');
  assertEquals(missing?.level, 'warning');
});

Deno.test('decideCoverageAlerts: missing 80% → critical', () => {
  const inputs: CoverageInput[] = [];
  for (let i = 0; i < 17; i++) inputs.push(mk(`M${i}`, '2026-07-27', 1000, null));
  for (let i = 0; i < 4; i++) inputs.push(mk(`K${i}`, '2026-07-27', 21_500_000, 21500));
  const s = auditCoverage(inputs);
  const d = decideCoverageAlerts(s);
  const missing = d.find((x) => x.kind === 'daily_snapshot_volume_missing');
  assertEquals(missing?.level, 'critical');
});

Deno.test('decideCoverageAlerts: under-cover 25% → warning', () => {
  const inputs: CoverageInput[] = [];
  for (let i = 0; i < 5; i++) inputs.push(mk(`U${i}`, '2026-07-27', 4_881_431, 17859));
  for (let i = 0; i < 15; i++) inputs.push(mk(`K${i}`, '2026-07-27', 21_500_000, 21500));
  const s = auditCoverage(inputs);
  const d = decideCoverageAlerts(s);
  const under = d.find((x) => x.kind === 'bsr_broker_coverage_low');
  assertEquals(under?.level, 'warning');
});

Deno.test('decideCoverageAlerts: under-cover 60% → critical', () => {
  const inputs: CoverageInput[] = [];
  for (let i = 0; i < 12; i++) inputs.push(mk(`U${i}`, '2026-07-27', 4_881_431, 17859));
  for (let i = 0; i < 8; i++) inputs.push(mk(`K${i}`, '2026-07-27', 21_500_000, 21500));
  const s = auditCoverage(inputs);
  const d = decideCoverageAlerts(s);
  const under = d.find((x) => x.kind === 'bsr_broker_coverage_low');
  assertEquals(under?.level, 'critical');
});

Deno.test('decideCoverageAlerts: everything ok → no alerts', () => {
  const inputs: CoverageInput[] = [];
  for (let i = 0; i < 25; i++) inputs.push(mk(`K${i}`, '2026-07-27', 21_500_000, 21500));
  const s = auditCoverage(inputs);
  const d = decideCoverageAlerts(s);
  assertEquals(d[0].triggered, false);
  assertEquals(d[0].reason, 'within_thresholds');
});
