#!/usr/bin/env node
/** Offline mandatory traffic gate: never calls Cloud or produces fake visitors. */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
const files = readdirSync('src/test/unit').filter(f =>
  /(traffic|funnel|attribution)/.test(f) && /\.test\.tsx?$/.test(f)
).map(f => `src/test/unit/${f}`);
files.push('src/test/integration/1.40-traffic-cost-controls.test.ts');
if (!files.some(f => f.endsWith('/traffic-recovery.test.ts'))) throw new Error('Missing recovery reconciliation seam');
console.log(`Traffic gate: ${files.length} test files; offline, no production writes`);
const result = spawnSync('bun', ['run', 'test:run:raw', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const sql = spawnSync('node', ['scripts/test-traffic-overview.mjs'], { stdio: 'inherit' });
if (sql.error) throw sql.error;
if (sql.status !== 0) process.exit(sql.status ?? 1);
const snapshot = spawnSync('bun', ['scripts/verify-traffic-snapshot.ts', 'src/test/fixtures/traffic-recovery-20261020.aggregate.json'], { stdio: 'inherit' });
if (snapshot.error) throw snapshot.error;
process.exit(snapshot.status ?? 1);