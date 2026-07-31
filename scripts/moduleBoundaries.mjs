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
import { join, relative, sep, dirname } from 'node:path';

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

/**
 * 從 barrel 的相對 re-export 推導「模組擁有的實作檔」。
 * 例：holdings barrel export 自 '../../components/holdings/index.js'
 *     → src/checkup/components/holdings/** 屬於 holdings 模組實作。
 * 自動推導避免另建一份會漂移的手寫清單。
 */
export function deriveOwnership(srcDir, modules) {
  const owners = new Map(); // 'src/checkup/...' prefix -> module
  const modulesDir = join(srcDir, 'checkup', 'modules');
  const BARREL_NAMES = ['index', 'free'];
  for (const m of modules) {
    const barrels = BARREL_NAMES.flatMap((base) =>
      ['ts', 'tsx', 'js', 'jsx']
        .map((ext) => join(modulesDir, m, `${base}.${ext}`))
        .filter((f) => existsSync(f)),
    );
    for (const barrel of barrels) {
      for (const spec of extractSpecifiers(readFileSync(barrel, 'utf-8'))) {
        if (!spec.startsWith('.')) continue;
        if (/^\.\/(?!\.)/.test(spec)) continue; // 模組自身檔案
        const abs = join(modulesDir, m, spec);
        let owned = relative(srcDir, abs).split(sep).join('/');
        owned = owned.replace(/\/index\.(t|j)sx?$/, '');
        owned = owned.replace(/\.(t|j)sx?$/, '');
        if (!owned || owned.startsWith('..')) continue;
        owners.set(`src/${owned}`, m);
      }
    }
  }
  return owners;
}


function ownerOf(relPath, owners) {
  const stripped = relPath.replace(/\.(t|j)sx?$/, '');
  for (const [prefix, m] of owners) {
    if (stripped === prefix || stripped.startsWith(`${prefix}/`)) return m;
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

/* ---------------------------------------------------------------------------
 * R5 free surface 收斂（ADR-0005 §7）
 * R5a：src/checkup/components/freecheckup/** 的每個實作檔都必須被某個模組 barrel
 *      （index 或 free）擁有，否則就是新的治外法權檔案。
 * R5b：模組外部不得深挖 freecheckup 實作檔，只能走 @/checkup/modules/<m>/free。
 * 例外只有兩類（ADR-0005 §7 寫死）：shell 自有 UI、harness 入口／測試。
 * ------------------------------------------------------------------------- */
export const FREE_DIR = 'src/checkup/components/freecheckup';

/** shell 自有 UI（ADR-0005 §2）：不歸任何模組，shell 可直接 import。 */
export const FREE_SHELL_OWNED = [
  `${FREE_DIR}/OnboardingOverlay`,
  `${FREE_DIR}/DemoFooterHint`,
];

/** 允許深挖 freecheckup 的呼叫端（ADR-0005 §7 例外清單）。 */
const FREE_DEEP_IMPORT_ALLOW = [
  /^src\/pages\/[A-Za-z0-9_]*HarnessEntry\.tsx$/,
  /^src\/test\//,
];

const isTestFile = (p) => /(^|\/)__tests__\//.test(p) || /\.(test|spec)\.[jt]sx?$/.test(p);

const stripExt = (p) => p.replace(/\.(t|j)sx?$/, '').replace(/\/index$/, '');

/** specifier（相對或 alias）解析成 repo 相對路徑；非指向 freecheckup 則回 null。 */
function resolveFreeTarget(spec, fileRel) {
  const norm = spec.replace(/\\/g, '/');
  if (/^(@\/|~\/)?checkup\/components\/freecheckup(\/|$)/.test(norm.replace(/^@\//, ''))) {
    return stripExt(norm.replace(/^[@~]\//, 'src/'));
  }
  if (norm.startsWith('.')) {
    const abs = join(dirname(fileRel), norm).split(sep).join('/');
    if (abs.startsWith(FREE_DIR)) return stripExt(abs);
  }
  return null;
}

/**
 * @param {{srcDir: string, root: string, owners: Map<string,string>, files: string[], rel: (p:string)=>string}} ctx
 */
function checkFreeSurface(ctx) {
  const { owners, files, rel } = ctx;
  const violations = [];
  const shellOwned = new Set(FREE_SHELL_OWNED);

  for (const abs of files) {
    const r = rel(abs);
    if (!r.startsWith(`${FREE_DIR}/`)) continue;
    if (isTestFile(r)) continue;
    const key = stripExt(r);
    if (shellOwned.has(key)) continue;
    if (!ownerOf(r, owners)) {
      violations.push({
        rule: 'R5_UNOWNED_FREE_FILE',
        file: r,
        specifier: '',
        message:
          `freecheckup 檔案 ${r} 未被任何模組 barrel 認領。請在 src/checkup/modules/<m>/free.ts ` +
          `re-export（ADR-0005 §1），或列入 shell 自有 UI 清單。`,
      });
    }
  }

  for (const abs of files) {
    const r = rel(abs);
    if (r.startsWith(`${FREE_DIR}/`)) continue; // 模組實作彼此互引由 R1/R4 管
    if (FREE_DEEP_IMPORT_ALLOW.some((re) => re.test(r))) continue;
    if (isTestFile(r)) continue;
    const src = readFileSync(abs, 'utf-8');
    for (const spec of extractSpecifiers(src)) {
      const target = resolveFreeTarget(spec, r);
      if (!target) continue;
      if (shellOwned.has(target)) continue;
      // 模組自身（含 free barrel）當然可以 re-export 自己擁有的檔案
      const importerModule = ownerOf(r, owners) ?? (r.match(/^src\/checkup\/modules\/([^/]+)\//)?.[1]);
      const targetModule = ownerOf(`${target}.ts`, owners) ?? ownerOf(target, owners);
      if (importerModule && importerModule === targetModule) continue;
      violations.push({
        rule: 'R5_FREE_DEEP_IMPORT',
        file: r,
        specifier: spec,
        message:
          `禁止深挖 free surface 實作檔；請改走 @/checkup/modules/${targetModule ?? '<m>'}/free（ADR-0005 §7）。`,
      });
    }
  }

  return violations;
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

  const owners = deriveOwnership(srcDir, modules);
  const allFiles = walk(srcDir);
  for (const file of allFiles) {
    const r = rel(file);
    if (ignore.some((re) => re.test(relative(root, file)))) continue;
    const src = readFileSync(file, 'utf-8');
    const specs = extractSpecifiers(src);
    const insideModule =
      modules.find((m) => r.startsWith(`src/checkup/modules/${m}/`)) ?? ownerOf(r, owners);

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
        // R4 元件層：相對路徑先解析成實體檔，再查擁有權（抓 '../closing/index.js' 這種寫法）
        let resolvedOwner = null;
        if (spec.startsWith('.')) {
          const abs = join(dirname(file), spec);
          resolvedOwner = ownerOf(rel(abs), owners);
        }
        if (resolvedOwner && resolvedOwner !== insideModule) {
          violations.push({
            rule: 'R4_SIBLING_COMPONENTS',
            file: r,
            specifier: spec,
            message: `${insideModule} 不得 import 手足模組 ${resolvedOwner} 的實作檔（元件／頁面／hook）。`,
          });
        } else if (compTarget && compTarget !== insideModule) {
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

  // R5 free surface 收斂（ADR-0005 §7）
  violations.push(
    ...checkFreeSurface({
      srcDir,
      root,
      owners,
      rel,
      files: allFiles.filter((f) => !ignore.some((re) => re.test(relative(root, f)))),
    }),
  );

  return violations;
}


export function formatViolations(violations) {
  if (violations.length === 0) return '✓ Checkup 深模組邊界：0 violations';
  return violations
    .map((v) => `✗ [${v.rule}] ${v.file}\n    import "${v.specifier}"\n    ${v.message}`)
    .join('\n');
}
