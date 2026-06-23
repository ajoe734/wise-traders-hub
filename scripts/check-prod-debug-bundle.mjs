#!/usr/bin/env node
/**
 * Production debug bundle guard.
 *
 * Builds the app (if dist/ is missing) and greps the emitted JS chunks for
 * dev-only debug labels that must NEVER appear in a production console.
 *
 * Usage:
 *   node scripts/check-prod-debug-bundle.mjs           # build if needed, then check
 *   node scripts/check-prod-debug-bundle.mjs --no-build  # use existing dist/
 *
 * Exits 1 (failing CI) if any forbidden string is found in dist/assets/*.js.
 *
 * Why this exists:
 *   useFreeCheckupBootstrap.js + FreeCheckup.jsx have DEV-only `console.log`
 *   guards (`if (!import.meta.env?.DEV) return () => {}`). Vite dead-code
 *   elimination replaces the logger with a noop at build time. This script
 *   verifies that on every production build — so a regression (e.g. someone
 *   forgetting the guard) blocks deploy instead of silently leaking debug
 *   logs to real users.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const DIST = 'dist/assets';

// Strings that must NOT appear in any production JS chunk.
// Match the actual `console.log("[label]", ...)` arguments — these are the
// human-visible prefixes a leaked DEV logger would print.
const FORBIDDEN = [
  '[checkup-bootstrap]',
  '[checkup-holdings]',
  // Generic guard: any console.log call that mentions a checkup- DEV label.
  // We deliberately keep this loose; the precise prefixes above catch the
  // common cases, this catches new ones added without updating this list.
  /console\.(log|info|debug)\(\s*["'`]\[checkup-/,
];

function ensureBuild() {
  if (process.argv.includes('--no-build')) return;
  if (existsSync(DIST)) return;
  console.log('[debug-guard] dist/ missing — running `bun run build`…');
  execSync('bun run build', { stdio: 'inherit' });
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (name.endsWith('.js')) yield p;
  }
}

ensureBuild();

if (!existsSync(DIST)) {
  console.error(`[debug-guard] ${DIST} not found after build`);
  process.exit(2);
}

const hits = [];
for (const file of walk(DIST)) {
  const text = readFileSync(file, 'utf8');
  for (const pat of FORBIDDEN) {
    if (typeof pat === 'string') {
      if (text.includes(pat)) hits.push({ file, pat });
    } else if (pat instanceof RegExp) {
      const m = text.match(pat);
      if (m) hits.push({ file, pat: pat.toString(), sample: m[0] });
    }
  }
}

if (hits.length) {
  console.error('[debug-guard] ❌ Forbidden DEV debug strings found in production bundle:');
  for (const h of hits) {
    console.error(`  - ${h.file}\n      pattern: ${h.pat}${h.sample ? `\n      sample: ${h.sample}` : ''}`);
  }
  console.error('\nFix: ensure the call site is gated by `import.meta.env?.DEV`.');
  process.exit(1);
}

console.log('[debug-guard] ✅ No DEV debug strings leaked into dist/assets/*.js');
console.log(`           patterns checked: ${FORBIDDEN.map((p) => (typeof p === 'string' ? p : p.toString())).join(', ')}`);
