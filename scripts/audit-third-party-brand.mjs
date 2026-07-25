#!/usr/bin/env node
/**
 * PR-2 CI Brand Audit
 *
 * 禁止在使用者可見的產品 UI 曝光第三方資料來源商標（FinMind），保留商業定價空間。
 *
 * 掃描範圍：src/**\/*.{ts,tsx,jsx}
 * 允許清單：
 *   - src/pages/DataSources.tsx        法遵/授權透明頁，必須列出所有來源
 *   - src/pages/company/**              admin ops 內部頁面
 *   - src/checkup/lib/stockMetaMulti.js 註解說明資料合併順序
 *   - src/checkup/hooks/useTwChipsDetail.ts 內部 hook 註解
 *   - src/checkup/components/freecheckup/HoldingsWorkbench.tsx 註解
 *
 * 使用者可見面（Chips / Journal / Signals / Landing）出現 "FinMind" 即失敗。
 */
import { readFileSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const NEEDLE = /FinMind/i;

const ALLOWLIST = new Set([
  'src/pages/DataSources.tsx',
  'src/checkup/lib/stockMetaMulti.js',
  'src/checkup/hooks/useTwChipsDetail.ts',
  'src/checkup/components/freecheckup/HoldingsWorkbench.tsx',
  'scripts/audit-third-party-brand.mjs',
]);
const ALLOW_PREFIX = ['src/pages/company/'];

function listFiles() {
  const out = execSync('git ls-files -co --exclude-standard "src/**"', {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  return out.split('\n').filter(Boolean).filter((f) => /\.(ts|tsx|js|jsx)$/.test(f));
}

const violations = [];
for (const rel of listFiles()) {
  if (ALLOWLIST.has(rel)) continue;
  if (ALLOW_PREFIX.some((p) => rel.startsWith(p))) continue;
  const abs = resolve(ROOT, rel);
  try {
    if (!statSync(abs).isFile()) continue;
  } catch { continue; }
  const text = readFileSync(abs, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (NEEDLE.test(line)) {
      violations.push({ file: rel, line: i + 1, snippet: line.trim().slice(0, 200) });
    }
  });
}

if (violations.length === 0) {
  console.log('✔ no third-party brand (FinMind) leaked into user-facing UI');
  process.exit(0);
}

console.error(`✘ ${violations.length} third-party brand leak(s) in user-facing code:\n`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}`);
  console.error(`    ${v.snippet}`);
}
console.error('\n請以「上游 API」「官方資料源」等中性字眼替代，或將檔案加入');
console.error('scripts/audit-third-party-brand.mjs 的 ALLOWLIST（僅限透明頁 / admin ops）。');
process.exit(1);
