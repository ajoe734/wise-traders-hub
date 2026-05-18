#!/usr/bin/env node
/**
 * Bundle-size feedback loop.
 *
 *   node scripts/bundle-snapshot.mjs            # compare current dist/ vs baseline
 *   node scripts/bundle-snapshot.mjs --save     # write current sizes as new baseline
 *
 * Reads every JS chunk in `dist/assets/`, hashes by *base name* (strip the
 * 8-char content hash so `Index-XYZ.js` ↔ `Index-ABC.js` compare cleanly),
 * computes brotli + raw size, and diffs against `.lovable/bundle-baseline.json`.
 *
 * Exit 1 if any chunk grew > 5% or > 5 KB (whichever is larger), or any new
 * chunk > 50 KB appeared without baseline. Use locally before/after large
 * refactors to confirm you didn't regress.
 *
 * Pure Node, no deps. Safe to run in any environment that has built `dist/`.
 */
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { brotliCompressSync, constants } from 'node:zlib';
import { resolve, basename } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = resolve(ROOT, 'dist/assets');
const BASELINE = resolve(ROOT, '.lovable/bundle-baseline.json');
const SAVE = process.argv.includes('--save');

const REGRESS_PCT = 0.05;
const REGRESS_ABS = 5 * 1024;
const NEW_CHUNK_THRESHOLD = 50 * 1024;

function stripHash(name) {
  // matches `Foo-aBc12XyZ.js` → `Foo.js`
  return name.replace(/-[A-Za-z0-9_-]{6,12}(\.js)$/, '$1');
}

function fmt(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function delta(curr, prev) {
  const diff = curr - prev;
  const pct = prev > 0 ? (diff / prev) * 100 : 0;
  const sign = diff > 0 ? '+' : '';
  return `${sign}${fmt(diff)} (${sign}${pct.toFixed(1)}%)`;
}

if (!existsSync(DIST)) {
  console.error(`✗ dist/assets not found at ${DIST}. Run \`bun run build\` first.`);
  process.exit(2);
}

const current = {};
for (const f of readdirSync(DIST)) {
  if (!f.endsWith('.js')) continue;
  const buf = readFileSync(resolve(DIST, f));
  const raw = statSync(resolve(DIST, f)).size;
  const br = brotliCompressSync(buf, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).length;
  const key = stripHash(basename(f));
  // If duplicates after stripping (rare), keep the largest.
  if (!current[key] || current[key].raw < raw) current[key] = { raw, br };
}

if (SAVE) {
  mkdirSync(resolve(ROOT, '.lovable'), { recursive: true });
  writeFileSync(BASELINE, JSON.stringify({ savedAt: new Date().toISOString(), chunks: current }, null, 2));
  console.log(`✓ saved baseline → ${BASELINE}`);
  console.log(`  ${Object.keys(current).length} chunks, total ${fmt(Object.values(current).reduce((s, c) => s + c.br, 0))} brotli`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.log('No baseline yet — run with --save to create one.\n');
  console.log('Current bundle (brotli):');
  for (const [k, v] of Object.entries(current).sort((a, b) => b[1].br - a[1].br)) {
    console.log(`  ${fmt(v.br).padStart(10)}  ${k}`);
  }
  const total = Object.values(current).reduce((s, c) => s + c.br, 0);
  console.log(`  ${'─'.repeat(10)}`);
  console.log(`  ${fmt(total).padStart(10)}  TOTAL`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const prev = baseline.chunks;

const regressions = [];
const newChunks = [];
const improvements = [];
const unchanged = [];

for (const [k, v] of Object.entries(current)) {
  const p = prev[k];
  if (!p) {
    newChunks.push({ k, br: v.br });
    continue;
  }
  const diff = v.br - p.br;
  const pct = p.br > 0 ? diff / p.br : 0;
  if (diff > REGRESS_ABS && pct > REGRESS_PCT) regressions.push({ k, prev: p.br, curr: v.br });
  else if (diff < -REGRESS_ABS) improvements.push({ k, prev: p.br, curr: v.br });
  else unchanged.push({ k, prev: p.br, curr: v.br });
}

const removed = Object.keys(prev).filter((k) => !current[k]);

const currTotal = Object.values(current).reduce((s, c) => s + c.br, 0);
const prevTotal = Object.values(prev).reduce((s, c) => s + c.br, 0);

console.log(`\nBundle diff (brotli)  baseline: ${baseline.savedAt}\n`);
console.log(`  TOTAL  ${fmt(prevTotal)} → ${fmt(currTotal)}  ${delta(currTotal, prevTotal)}\n`);

if (regressions.length) {
  console.log('  ✗ Regressions:');
  for (const r of regressions) console.log(`     ${r.k}  ${fmt(r.prev)} → ${fmt(r.curr)}  ${delta(r.curr, r.prev)}`);
  console.log();
}
if (newChunks.length) {
  console.log('  + New chunks:');
  for (const n of newChunks) console.log(`     ${n.k}  ${fmt(n.br)}`);
  console.log();
}
if (improvements.length) {
  console.log('  ✓ Improvements:');
  for (const i of improvements) console.log(`     ${i.k}  ${fmt(i.prev)} → ${fmt(i.curr)}  ${delta(i.curr, i.prev)}`);
  console.log();
}
if (removed.length) {
  console.log(`  − Removed: ${removed.join(', ')}\n`);
}
console.log(`  · Unchanged (within threshold): ${unchanged.length} chunks\n`);

const fatal =
  regressions.length > 0 || newChunks.some((n) => n.br > NEW_CHUNK_THRESHOLD);
if (fatal) {
  console.log('FAIL: regressions or large new chunks detected. Investigate, then `--save` once intentional.');
  process.exit(1);
}
console.log('OK: no significant regressions.');
