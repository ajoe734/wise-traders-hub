#!/usr/bin/env node
/** Offline mandatory traffic gate: never calls Cloud or produces fake visitors. */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
const files = readdirSync('src/test/unit').filter(f =>
  /^(traffic-|funnel-|conversion-attribution|platform-attribution)/.test(f) && /\.test\.tsx?$/.test(f)
).map(f => `src/test/unit/${f}`);
files.push('src/test/integration/1.40-traffic-cost-controls.test.ts');
if (!files.some(f => f.endsWith('/traffic-recovery.test.ts'))) throw new Error('Missing recovery reconciliation seam');
console.log(`Traffic gate: ${files.length} test files; offline, no production writes`);
const result = spawnSync('bun', ['run', 'test:run:raw', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);