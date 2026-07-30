#!/usr/bin/env node
// One-shot codemod: migrate remaining edge functions off inline createClient()
// onto _shared/supabaseClients.ts (serviceClient / userClient).
//
// Conservative by design: anything it cannot classify with certainty is left
// untouched and reported, so a human finishes the tail by hand.
//
// Usage: node scripts/codemod-supabase-clients.mjs [--write]

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FN_DIR = join(ROOT, 'supabase/functions');
const WRITE = process.argv.includes('--write');
const SKIP = new Set(['_shared/supabaseClients.ts', 'mcp/index.ts']);

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (e.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Find balanced-paren extent of a call starting at the '(' index. */
function callExtent(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return i;
    } else if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') i++;
        i++;
      }
    }
  }
  return -1;
}

function classify(argsText) {
  const t = argsText;
  if (/SERVICE|service/.test(t)) return 'service';
  if (/ANON|anon|PUBLISHABLE|publishable/.test(t)) return 'user';
  return null;
}

const report = { changed: [], manual: [] };

for (const file of walk(FN_DIR)) {
  const rel = relative(FN_DIR, file).split('\\').join('/');
  if (SKIP.has(rel)) continue;
  let src = readFileSync(file, 'utf8');
  if (!/\bcreateClient\s*\(/.test(src)) continue;

  const needs = new Set();
  const unresolved = [];
  let guard = 0;

  for (;;) {
    if (guard++ > 50) break;
    const m = /(?<![\w.])createClient\s*\(/.exec(src);
    if (!m) break;
    const open = m.index + m[0].length - 1;
    const close = callExtent(src, open);
    if (close < 0) { unresolved.push('unbalanced call'); break; }
    const args = src.slice(open + 1, close);
    const kind = classify(args);
    if (!kind) {
      unresolved.push(args.replace(/\s+/g, ' ').slice(0, 90));
      // neutralise so the loop advances, then restore afterwards
      src = src.slice(0, m.index) + '__CREATECLIENT_UNRESOLVED__(' + args + ')' + src.slice(close + 1);
      continue;
    }
    if (kind === 'user') {
      // need the request identifier: prefer an Authorization header pull nearby
      needs.add('userClient');
      src = src.slice(0, m.index) + 'userClient(req)' + src.slice(close + 1);
    } else {
      needs.add('serviceClient');
      src = src.slice(0, m.index) + 'serviceClient()' + src.slice(close + 1);
    }
  }
  src = src.replaceAll('__CREATECLIENT_UNRESOLVED__(', 'createClient(');

  if (needs.size === 0) {
    report.manual.push({ file: rel, reasons: unresolved });
    continue;
  }

  // drop the direct supabase-js import
  src = src.replace(
    /^import\s*\{[^}]*\}\s*from\s*['"](?:npm:|https:\/\/esm\.sh\/)@supabase\/supabase-js[^'"]*['"];?\r?\n/gm,
    '',
  );
  // also drop type-only re-imports that only pulled createClient
  const importLine = `import { ${[...needs].sort().join(', ')} } from '../_shared/supabaseClients.ts';\n`;
  if (!/_shared\/supabaseClients\.ts/.test(src)) {
    // insert after the leading comment block / first import
    const lines = src.split('\n');
    let insertAt = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('import ')) { insertAt = i; break; }
      if (lines[i].startsWith('//') || lines[i].trim() === '') insertAt = i + 1;
      else { insertAt = i; break; }
    }
    lines.splice(insertAt, 0, importLine.trimEnd());
    src = lines.join('\n');
  } else {
    src = src.replace(
      /import\s*\{([^}]*)\}\s*from\s*['"]\.\.\/_shared\/supabaseClients\.ts['"];/,
      (_all, inner) => {
        const set = new Set(inner.split(',').map((s) => s.trim()).filter(Boolean));
        for (const n of needs) set.add(n);
        return `import { ${[...set].sort().join(', ')} } from '../_shared/supabaseClients.ts';`;
      },
    );
  }

  if (WRITE) writeFileSync(file, src);
  report.changed.push({ file: rel, needs: [...needs], unresolved });
}

console.log(`changed: ${report.changed.length}`);
for (const c of report.changed) {
  console.log(`  ${c.file} → ${c.needs.join('+')}${c.unresolved.length ? `  ⚠ left: ${c.unresolved.join(' | ')}` : ''}`);
}
console.log(`\nmanual: ${report.manual.length}`);
for (const m of report.manual) console.log(`  ${m.file} :: ${m.reasons.join(' | ')}`);
if (!WRITE) console.log('\n(dry run — pass --write to apply)');
