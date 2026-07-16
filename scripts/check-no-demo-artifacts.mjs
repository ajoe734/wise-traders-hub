#!/usr/bin/env node
/**
 * 禁詞守門：demoBanner / demoCTA / --demo-* / demo-banner
 *
 * 目的：DemoBanner 與 DemoCTA 於 §6 精簡時刪除，且對應 CSS custom prop `--demo-*`
 * 也一併退場。此檢查防止未來 PR 意外把它們重新引入 src/、e2e/、scripts/、docs/、
 * public/、supabase/ 等程式或樣式資產。
 *
 * 規則：
 *   - 匹配任何檔案中出現 DemoBanner / DemoCTA / demoBanner / demoCTA / demo-banner
 *     或 CSS 變數 --demo-（例如 --demo-bg, var(--demo-accent)）都視為違規
 *
 * 允許清單（ALLOWLIST）：
 *   - 檔案內容全部為「反向斷言」（斷言 count===0 或註解說明已刪除）
 *   - 本腳本 & README/CHANGELOG/歷史 handoff 文件
 *
 * 退出碼：0 = 通過，1 = 違規（CI 會 fail）。
 */
import { readFileSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();

const SCAN_ROOTS = ['src', 'e2e', 'scripts', 'docs', 'public', 'supabase', 'remotion', 'brand'];
const SCAN_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.css', '.scss', '.html', '.md', '.mdx',
  '.json', '.yml', '.yaml', '.sql', '.svg',
]);

const IGNORE_DIR_PARTS = new Set([
  'node_modules', 'dist', '.git', 'coverage', 'playwright-report',
  'blob-report', 'test-results',
]);
const IGNORE_SUFFIX = ['-snapshots'];

// 這些檔案「必然」包含反向斷言或歷史記錄，明確 allowlist。
const ALLOWLIST_FILES = new Set([
  'scripts/check-no-demo-artifacts.mjs',
  'e2e/freecheckup-demo-first-fold.spec.ts',   // 斷言 demo-banner count === 0
  'e2e/freecheckup-tabs-visual.spec.ts',       // 註解說明清理背景
  'docs/demo-data-maintenance.md',             // 維運說明允許提及歷史元件（清理紀錄）
  '.lovable/plan.md',
  '.lovable/DESIGN_HANDOFF.md',
  '.lovable/freecheckup-a1.md',
]);

const PATTERNS = [
  { name: 'DemoBanner',     re: /DemoBanner/g },
  { name: 'DemoCTA',        re: /DemoCTA/g },
  { name: 'demoBanner',     re: /demoBanner/g },
  { name: 'demoCTA',        re: /demoCTA/g },
  { name: 'demo-banner',    re: /demo-banner/g },
  { name: '--demo-*',       re: /--demo-[a-z0-9-]+/g },
];

/** 追蹤 + 未追蹤（未被 .gitignore 排除）皆掃描，避免 PR 前本地漏檢。 */
function listFiles() {
  let out = '';
  try {
    out = execSync('git ls-files -co --exclude-standard', {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    return [];
  }
  return out.split('\n').filter(Boolean);
}

function shouldScan(relPath) {
  if (ALLOWLIST_FILES.has(relPath)) return false;
  const parts = relPath.split('/');
  if (!SCAN_ROOTS.includes(parts[0])) return false;
  for (const part of parts) {
    if (IGNORE_DIR_PARTS.has(part)) return false;
    if (IGNORE_SUFFIX.some((suf) => part.endsWith(suf))) return false;
  }
  const dot = relPath.lastIndexOf('.');
  if (dot < 0) return false;
  const ext = relPath.slice(dot);
  if (!SCAN_EXTS.has(ext)) return false;
  return true;
}

const violations = [];

for (const rel of listFiles()) {
  if (!shouldScan(rel)) continue;
  const abs = resolve(ROOT, rel);
  let text;
  try {
    const st = statSync(abs);
    if (!st.isFile() || st.size > 2 * 1024 * 1024) continue;
    text = readFileSync(abs, 'utf8');
  } catch {
    continue;
  }
  for (const { name, re } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const before = text.slice(0, m.index);
      const line = before.split('\n').length;
      const lineText = text.split('\n')[line - 1] || '';
      violations.push({ file: rel, line, rule: name, snippet: lineText.trim().slice(0, 200) });
    }
  }
}

if (violations.length === 0) {
  console.log('✔ no forbidden demo artifacts (DemoBanner / DemoCTA / --demo-*) found');
  process.exit(0);
}

console.error(`✘ ${violations.length} forbidden demo artifact reference(s) detected:\n`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  [${v.rule}]`);
  console.error(`    ${v.snippet}`);
}
console.error('\n這些識別符 / CSS token 已被清理，禁止重新引入。');
console.error('若確有正當理由（例：歷史測試反向斷言），請將檔案加入');
console.error('scripts/check-no-demo-artifacts.mjs 的 ALLOWLIST_FILES。');
process.exit(1);
