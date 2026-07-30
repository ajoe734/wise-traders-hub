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
  'supabase/functions/_shared/signalActionLabels.ts', // Deno 鏡像單一資料源
  // 持倉看板「決策標籤」與訊號 action 是不同領域（exit/review/hold 決策建議），不受此稽核管轄
  'src/checkup/components/freecheckup/HoldingsDetailPanel.tsx',
]);

// 掃描範圍必須包含 edge functions —— 標籤漂移（'續抱' / 缺 teaching）就是從這裡長出來的。
const SCAN_DIRS = 'src scripts supabase/functions';

function rg(pattern) {
  try {
    return execSync(
      `rg -n --no-heading -S ${JSON.stringify(pattern)} ${SCAN_DIRS} 2>/dev/null || true`,
      { encoding: 'utf8' },
    )
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

// Rule 4: map-shaped literal like `buy: '買進'` / `buy: "買進"` anywhere
// (含 edge functions) — 這正是 share-og / line-push / publish 漂移的來源。
for (const line of rg(`(buy|sell|add|trim|exit|hold|teaching)\\s*:\\s*['"](買進|賣出|加碼|減碼|平損|觀察|教學|續抱)['"]`)) {
  const file = line.split(':', 1)[0];
  if (ALLOWLIST.has(file)) continue;
  violations.push(`[duplicate-action-map] ${line}`);
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

