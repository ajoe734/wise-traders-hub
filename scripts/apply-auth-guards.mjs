#!/usr/bin/env node
// Batch-injects runtime auth guards into edge functions that currently only
// carry a `// AUTH: user` / `// AUTH: cron` marker.
//
// Strategy per file:
//   1. Ensure `../_shared/authGuard.ts` is imported.
//   2. Insert a guard block at the top of the request handler:
//      - cron: `if (req.method !== 'OPTIONS') { try { requireCronKey(req); } catch (e) { ... } }`
//      - user: same but `await requireCaller(req)`
//   3. Skip files that already have a runtime guard.
//
// Handler entry detection: match the first `async (req` occurring inside a
// `Deno.serve(...)` or `withLogging(...` block. Insert directly after that
// arrow's opening brace.
//
// Idempotent: re-running is a no-op once a `requireCaller(`/`requireCronKey(`
// call is present.

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FN_ROOT = 'supabase/functions';
const SKIP = new Set(['_shared', 'mcp']);
const RUNTIME_GUARD_RE = /requireCaller\s*\(|requireCronKey\s*\(|CheckMacValue|verifyLinepaySignature|verifyAcpaySignature|X-Line-Signature|getCallerUserId|auth\.getUser|getClaims\(|consumeCheckupQuota\s*\(|requireCheckupAuth\s*\(|verifyToken\s*\(|extractApiKey\s*\(|defineMcp\s*\(/;

const HANDLER_ENTRY_RE = /(async\s*\(\s*(?:req|_req|request)\b[^)]*\)\s*=>\s*\{)/;

const GUARD_USER = `
  // AUTH: user (Phase M-2 runtime enforcement)
  if (req.method !== 'OPTIONS') {
    try { await requireCaller(req); }
    catch (e) {
      if (e instanceof AuthError) {
        return new Response(JSON.stringify({ error: e.message, code: e.code }), {
          status: e.status,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      throw e;
    }
  }
`;

const GUARD_CRON = `
  // AUTH: cron (Phase M-2 runtime enforcement)
  if (req.method !== 'OPTIONS') {
    try { requireCronKey(req); }
    catch (e) {
      if (e instanceof AuthError) {
        return new Response(JSON.stringify({ error: e.message, code: e.code }), {
          status: e.status,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      throw e;
    }
  }
`;

function classify(src) {
  if (/\/\/\s*AUTH:\s*user\b/i.test(src)) return 'user';
  if (/\/\/\s*AUTH:\s*cron\b/i.test(src)) return 'cron';
  return null;
}

function ensureImport(src, symbols) {
  // Look for existing authGuard import
  const importRe = /import\s*\{([^}]*)\}\s*from\s*['"]\.\.\/_shared\/authGuard\.ts['"]\s*;?/;
  const m = src.match(importRe);
  if (m) {
    const existing = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    const merged = Array.from(new Set([...existing, ...symbols]));
    return src.replace(importRe, `import { ${merged.join(', ')} } from '../_shared/authGuard.ts';`);
  }
  // Insert after the first line that starts with `import`.
  const lines = src.split('\n');
  const idx = lines.findIndex((l) => /^import\s/.test(l));
  const insertAt = idx === -1 ? 0 : idx + 1;
  lines.splice(insertAt, 0, `import { ${symbols.join(', ')}, AuthError } from '../_shared/authGuard.ts';`);
  return lines.join('\n');
}

function injectGuard(src, guardBlock) {
  const m = src.match(HANDLER_ENTRY_RE);
  if (!m) return null;
  const idx = src.indexOf(m[1]);
  const insertPos = idx + m[1].length;
  return src.slice(0, insertPos) + guardBlock + src.slice(insertPos);
}

function processFn(name) {
  const path = join(FN_ROOT, name, 'index.ts');
  let src;
  try { src = readFileSync(path, 'utf8'); } catch { return { name, status: 'no-file' }; }
  if (RUNTIME_GUARD_RE.test(src)) return { name, status: 'already-guarded' };
  const cls = classify(src);
  if (!cls) return { name, status: 'no-marker' };

  const guardBlock = cls === 'user' ? GUARD_USER : GUARD_CRON;
  const symbol = cls === 'user' ? 'requireCaller' : 'requireCronKey';

  let out = ensureImport(src, [symbol]);
  // Make sure AuthError is available (ensureImport handles the AuthError only when
  // creating a new import; if the import already exists, add AuthError explicitly).
  if (!/\bAuthError\b/.test(out)) {
    out = ensureImport(out, [symbol, 'AuthError']);
  }
  const injected = injectGuard(out, guardBlock);
  if (!injected) return { name, status: 'no-handler-entry' };

  writeFileSync(path, injected);
  return { name, status: `guarded-${cls}` };
}

function main() {
  const fns = readdirSync(FN_ROOT).filter((d) => {
    if (SKIP.has(d)) return false;
    try { return statSync(join(FN_ROOT, d, 'index.ts')).isFile(); } catch { return false; }
  });

  const buckets = {};
  for (const name of fns) {
    const r = processFn(name);
    (buckets[r.status] ||= []).push(name);
  }

  for (const [status, names] of Object.entries(buckets)) {
    console.log(`\n[${status}] (${names.length})`);
    if (status.startsWith('guarded-') || status === 'no-handler-entry' || status === 'no-marker') {
      names.sort().forEach((n) => console.log(`  ${n}`));
    }
  }
}

main();
