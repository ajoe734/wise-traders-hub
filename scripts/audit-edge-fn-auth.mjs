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

// A file may declare its auth class by EITHER calling the guard helper
// (real runtime enforcement) OR by an `// AUTH: <class>` marker comment
// (documented intent, pending guard swap). Both count for coverage.
const CLASSIFIERS = [
  { cls: 'user',    pattern: /requireCaller\s*\(|\/\/\s*AUTH:\s*user\b/i },
  { cls: 'cron',    pattern: /requireCronKey\s*\(|\/\/\s*AUTH:\s*cron\b/i },
  { cls: 'webhook', pattern: /\/\/\s*AUTH:\s*webhook-signature/i },
  { cls: 'public',  pattern: /\/\/\s*AUTH:\s*public\b/i },
];

// A function has a "real" runtime guard when it calls the helper (or an
// established webhook/public pattern). Comment-only markers count as
// documented-but-pending — surfaced separately so we can burn them down.
const RUNTIME_GUARD = /requireCaller\s*\(|requireCronKey\s*\(|CheckMacValue|verifyLinepaySignature|verifyAcpaySignature|X-Line-Signature|getCallerUserId|auth\.getUser|getClaims\(/;

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
    const hasRuntimeGuard = RUNTIME_GUARD.test(src);
    rows.push({ name: fn.name, cls, reason, hasRuntimeGuard });
    if (!cls) unclassified.push(fn.name);
  }

  rows.sort((a, b) => a.name.localeCompare(b.name));

  const pending = rows.filter(
    (r) => (r.cls === 'user' || r.cls === 'cron') && !r.hasRuntimeGuard,
  );

  if (write) {
    const lines = [
      '# Edge Function Auth Matrix',
      '',
      '> 由 `scripts/audit-edge-fn-auth.mjs --write` 自動產生，勿手動編輯。',
      '> 分類憲法見 `supabase/functions/_shared/authGuard.ts`。',
      '',
      `覆蓋率：${rows.length - unclassified.length} / ${rows.length}`,
      `Runtime guard 已上：${rows.length - pending.length - unclassified.length} / ${rows.length - unclassified.length}`,
      '',
      '| Function | Auth Class | Runtime Guard |',
      '| --- | --- | --- |',
      ...rows.map((r) => {
        const cls = r.cls ?? '❌ **UNCLASSIFIED**';
        const rg = r.cls === 'webhook' || r.cls === 'public'
          ? '—'
          : (r.hasRuntimeGuard ? '✅' : '⏳ pending');
        return `| \`${r.name}\` | ${cls} | ${rg} |`;
      }),
      '',
    ];
    writeFileSync(MATRIX_DOC, lines.join('\n'));
    console.log(`wrote ${MATRIX_DOC} (${rows.length} functions, ${pending.length} pending guard)`);
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
