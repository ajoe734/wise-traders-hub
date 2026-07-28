#!/usr/bin/env node
// scripts/audit-edge-fn-auth.mjs
//
// Static auditor: every edge function under supabase/functions/<name>/index.ts
// MUST declare its auth class via ONE of these markers, appearing in the file:
//
//   requireCaller(       → user JWT verified endpoint
//   requireCronKey(      → scheduler-only endpoint (X-Cron-Key)
//   // AUTH: webhook-signature      → provider-signed webhook
//   // AUTH: public                 → deliberately public endpoint (e.g. og-card)
//
// Usage:
//   node scripts/audit-edge-fn-auth.mjs           # exit 1 on any uncategorized fn
//   node scripts/audit-edge-fn-auth.mjs --write   # rewrite docs/security/edge-function-auth-matrix.md
//
// The script exits non-zero if any function lacks a marker; CI blocks the PR.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FN_ROOT = 'supabase/functions';
const MATRIX_DOC = 'docs/security/edge-function-auth-matrix.md';

const CLASSIFIERS = [
  { cls: 'user',    pattern: /requireCaller\s*\(/ },
  { cls: 'cron',    pattern: /requireCronKey\s*\(/ },
  { cls: 'webhook', pattern: /\/\/\s*AUTH:\s*webhook-signature/i },
  { cls: 'public',  pattern: /\/\/\s*AUTH:\s*public/i },
];

function listFunctions() {
  return readdirSync(FN_ROOT)
    .filter((d) => d !== '_shared')
    .map((d) => ({ name: d, path: join(FN_ROOT, d, 'index.ts') }))
    .filter((f) => {
      try { return statSync(f.path).isFile(); } catch { return false; }
    });
}

function classify(src) {
  const hits = CLASSIFIERS.filter((c) => c.pattern.test(src)).map((c) => c.cls);
  if (hits.length === 0) return { cls: null, reason: 'no auth marker' };
  if (hits.length > 1) return { cls: hits.join('+'), reason: 'multiple markers' };
  return { cls: hits[0], reason: null };
}

function main() {
  const write = process.argv.includes('--write');
  const fns = listFunctions();
  const rows = [];
  const unclassified = [];

  for (const fn of fns) {
    const src = readFileSync(fn.path, 'utf8');
    const { cls, reason } = classify(src);
    rows.push({ name: fn.name, cls, reason });
    if (!cls) unclassified.push(fn.name);
  }

  rows.sort((a, b) => a.name.localeCompare(b.name));

  if (write) {
    const lines = [
      '# Edge Function Auth Matrix',
      '',
      '> 由 `scripts/audit-edge-fn-auth.mjs --write` 自動產生，勿手動編輯。',
      '> 分類憲法見 `supabase/functions/_shared/authGuard.ts`。',
      '',
      `覆蓋率：${rows.length - unclassified.length} / ${rows.length}`,
      '',
      '| Function | Auth Class |',
      '| --- | --- |',
      ...rows.map((r) => `| \`${r.name}\` | ${r.cls ?? '❌ **UNCLASSIFIED**'} |`),
      '',
    ];
    writeFileSync(MATRIX_DOC, lines.join('\n'));
    console.log(`wrote ${MATRIX_DOC} (${rows.length} functions)`);
  }

  if (unclassified.length > 0) {
    console.error(`\n❌ ${unclassified.length} edge function(s) missing auth marker:`);
    for (const n of unclassified) console.error(`  - ${n}`);
    console.error('\nAdd ONE of these to the top of index.ts:');
    console.error('  await requireCaller(req);         // user JWT');
    console.error('  requireCronKey(req);              // scheduler');
    console.error('  // AUTH: webhook-signature       // provider webhook');
    console.error('  // AUTH: public                  // intentionally public');
    process.exit(1);
  }

  console.log(`✅ all ${rows.length} edge functions classified`);
}

main();
