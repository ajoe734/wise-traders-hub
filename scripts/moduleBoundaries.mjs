/**
 * Checkup 深模組邊界守衛（機制化，非自律）
 *
 * 契約：docs/adr/0001-checkup-five-deep-modules.md
 *   R1 手足邊界：模組 A 內任何檔案不得 import 手足模組 B（barrel 或深路徑皆禁）。
 *   R2 barrel-only：模組外部只能 import `@/checkup/modules/<m>`，不得深挖內部檔案。
 *   R3 barrel 存在：每個宣告的模組都必須有 index.ts(x) barrel。
 *   R4 元件層：模組內不得 import 其他模組專屬的 components/<module> 目錄。
 *
 * 介面刻意極小：`checkModuleBoundaries({ root?, modules? }) -> Violation[]`
 * 空陣列 = 通過。eslint / vitest / CI 三處共用同一份判定，避免規則漂移。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const CHECKUP_MODULES = ['holdings', 'closing', 'events', 'tradeIO', 'research'];

const CODE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const IMPORT_RE = /(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (CODE_RE.test(name)) out.push(p);
  }
  return out;
}

function extractSpecifiers(src) {
  const out = [];
  IMPORT_RE.lastIndex = 0;
  let m;
  while ((m = IMPORT_RE.exec(src)) !== null) {
    const spec = m[1] || m[2] || m[3];
    if (spec) out.push(spec);
  }
  return out;
}

/** 把任意 specifier 正規化成 `modules/<name>/<rest>` 形式（若指向某個深模組）。 */
function resolveModuleTarget(spec, modules) {
  const norm = spec.replace(/\\/g, '/');
  for (const m of modules) {
    const patterns = [
      new RegExp(`(?:^|/)checkup/modules/${m}(/|$)`),
      new RegExp(`(?:^|/)modules/${m}(/|$)`),
      new RegExp(`^\\.{1,2}(?:/\\.\\.)*/${m}(/|$)`),
    ];
    for (const re of patterns) {
      if (re.test(norm)) {
        const idx = norm.indexOf(`${m}/`);
        const rest = idx >= 0 ? norm.slice(idx + m.length + 1) : '';
        return { module: m, rest };
      }
    }
  }
  return null;
}

function componentTarget(spec, modules) {
  const norm = spec.replace(/\\/g, '/');
  for (const m of modules) {
    if (new RegExp(`(?:^|/)components/${m}(/|$)`).test(norm)) return m;
  }
  return null;
}

/**
 * @param {{root?: string, modules?: string[], srcDir?: string, ignore?: RegExp[]}} [opts]
 * @returns {{rule: string, file: string, specifier: string, message: string}[]}
 */
export function checkModuleBoundaries(opts = {}) {
  const root = opts.root ?? process.cwd();
  const modules = opts.modules ?? CHECKUP_MODULES;
  const srcDir = opts.srcDir ?? join(root, 'src');
  const modulesDir = join(srcDir, 'checkup', 'modules');
  const ignore = opts.ignore ?? [
    /^src[\\/]test[\\/]/,
    /^scripts[\\/]/,
  ];
  const violations = [];
  const rel = (p) => relative(root, p).split(sep).join('/');

  // R3 barrel 存在
  for (const m of modules) {
    const hasBarrel = ['index.ts', 'index.tsx', 'index.js', 'index.jsx'].some((f) =>
      existsSync(join(modulesDir, m, f)),
    );
    if (!hasBarrel) {
      violations.push({
        rule: 'R3_MISSING_BARREL',
        file: `src/checkup/modules/${m}`,
        specifier: '',
        message: `深模組 ${m} 缺少 barrel（index.ts），對外介面無法收斂。`,
      });
    }
  }

  const allFiles = walk(srcDir);
  for (const file of allFiles) {
    const r = rel(file);
    if (ignore.some((re) => re.test(relative(root, file)))) continue;
    const src = readFileSync(file, 'utf-8');
    const specs = extractSpecifiers(src);
    const insideModule = modules.find((m) =>
      r.startsWith(`src/checkup/modules/${m}/`),
    );

    for (const spec of specs) {
      const target = resolveModuleTarget(spec, modules);
      const compTarget = componentTarget(spec, modules);

      if (insideModule) {
        // R1 手足邊界
        if (target && target.module !== insideModule) {
          violations.push({
            rule: 'R1_SIBLING_IMPORT',
            file: r,
            specifier: spec,
            message: `${insideModule} 不得依賴手足模組 ${target.module}；請走 URL params / store selector / shell event bus。`,
          });
        }
        // R4 元件層
        if (compTarget && compTarget !== insideModule) {
          violations.push({
            rule: 'R4_SIBLING_COMPONENTS',
            file: r,
            specifier: spec,
            message: `${insideModule} 不得 import 手足模組專屬元件目錄 components/${compTarget}。`,
          });
        }
      } else if (target && target.rest) {
        // R2 barrel-only（模組外部）
        violations.push({
          rule: 'R2_DEEP_IMPORT',
          file: r,
          specifier: spec,
          message: `深模組 ${target.module} 只能從 barrel（@/checkup/modules/${target.module}）進入。`,
        });
      }
    }
  }

  return violations;
}

export function formatViolations(violations) {
  if (violations.length === 0) return '✓ Checkup 深模組邊界：0 violations';
  return violations
    .map((v) => `✗ [${v.rule}] ${v.file}\n    import "${v.specifier}"\n    ${v.message}`)
    .join('\n');
}
