#!/usr/bin/env node
/**
 * Guardrails for signal action labels.
 *
 * Fails CI when:
 *  1. Any file outside the allowlist defines a hardcoded map whose value
 *     looks like `{ label: '買進', ... }` — that's a duplicate of
 *     SIGNAL_ACTION_META and will drift out of sync.
 *  2. Any code uses `actionLabels[...]` / `actionLabels?.[...]` / or any
 *     `actionLabels.*` fallback pattern — all action labels must come from
 *     `getActionMeta()` / `SIGNAL_ACTION_META` in `src/lib/signalAction.ts`.
 *  3. Any code uses `|| actionLabels.buy` or `?? actionLabels.buy` as a
 *     fallback — unknown actions must render "未知" via getActionMeta(),
 *     never silently as 買進.
 */
import { execSync } from 'node:child_process';

const ALLOWLIST = new Set([
  'src/lib/signalAction.ts',
  'src/pages/_adminSignals/actionLabels.ts', // backward-compat re-export only
  'src/test/unit/signalActionLabel.test.ts',
  'src/test/exportJournalPdfActionMeta.test.ts', // contract test — expected to contain literals
  'scripts/audit-signal-action-labels.mjs',
]);

function rg(pattern) {
  try {
    return execSync(`rg -n --no-heading -S ${JSON.stringify(pattern)} src scripts 2>/dev/null || true`, {
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

const violations = [];

// Rule 1: duplicate `{ label: '買進' ... }` outside allowlist
for (const line of rg("label: '買進'")) {
  const file = line.split(':', 1)[0];
  if (!ALLOWLIST.has(file)) violations.push(`[duplicate-map] ${line}`);
}

// Rule 2: any bracket access on `actionLabels` (including optional chaining)
// outside the backward-compat re-export file.
for (const line of rg('actionLabels(\\?)?\\.\\[')) {
  const file = line.split(':', 1)[0];
  if (ALLOWLIST.has(file)) continue;
  violations.push(`[actionLabels-bracket-access] ${line}`);
}

// Rule 3: `actionLabels.*` used as `||` / `??` fallback right after `actionLabels[...]`
for (const line of rg('actionLabels\\.(buy|sell|add|trim|exit|hold|teaching)')) {
  const file = line.split(':', 1)[0];
  if (ALLOWLIST.has(file)) continue;
  if (/actionLabels\[[^\]]+\]\s*(\|\||\?\?)\s*actionLabels\./.test(line)) {
    violations.push(`[fallback-to-buy] ${line}`);
  }
}

if (violations.length) {
  console.error('\n❌ signal action label audit failed:\n');
  violations.forEach((v) => console.error('  ' + v));
  console.error(
    '\nAll UI must render action labels via getActionMeta() / SIGNAL_ACTION_META from @/lib/signalAction.\n' +
      'Never access `actionLabels[...]` or fall back to `actionLabels.buy` — unknown actions must render as 未知.\n',
  );
  process.exit(1);
}

console.log('✅ signal action label audit passed');

