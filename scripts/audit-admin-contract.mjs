#!/usr/bin/env node
// Static auditor for two edge-function caller contracts:
//
//  1. supabaseClients migration — no edge function may construct its own
//     Supabase client. Use `serviceClient()` / `userClient(req)` from
//     `_shared/supabaseClients.ts`.
//
//  2. company_admin contract — no edge function may hand-roll an admin role
//     check. Use `requireCompanyAdmin(req)` / `requireExpertOwnerOrAdmin()` /
//     `listCompanyAdminIds()` from `_shared/adminGuard.ts`, and render
//     failures with `authErrorResponse(err, req)`.
//
// Run: node scripts/audit-admin-contract.mjs

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FN_DIR = join(ROOT, 'supabase/functions');

// Files that legitimately own the primitives being audited.
const CLIENT_OWNERS = new Set(['_shared/supabaseClients.ts']);
const ADMIN_OWNERS = new Set(['_shared/adminGuard.ts', '_shared/adminGuard_test.ts']);

// mcp/ runs on a Node-flavoured runtime with its own client bootstrap.
const CLIENT_EXEMPT = new Set(['mcp/index.ts']);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

export function auditEdgeContracts() {
  const violations = [];
  for (const file of walk(FN_DIR)) {
    const rel = relative(FN_DIR, file).split('\\').join('/');
    const src = readFileSync(file, 'utf8');

    // --- contract 1: client construction -------------------------------
    if (!CLIENT_OWNERS.has(rel) && !CLIENT_EXEMPT.has(rel)) {
      if (/\bcreateClient\s*\(/.test(src)) {
        violations.push({
          file: rel,
          rule: 'no-inline-create-client',
          hint: "use serviceClient() / userClient(req) from '../_shared/supabaseClients.ts'",
        });
      }
      if (/from\s+['"](npm:|https:\/\/esm\.sh\/)@supabase\/supabase-js/.test(src)) {
        violations.push({
          file: rel,
          rule: 'no-direct-supabase-js-import',
          hint: 'import clients from _shared/supabaseClients.ts so the pin stays single-sourced',
        });
      }
    }

    // --- contract 2: company_admin checks ------------------------------
    if (!ADMIN_OWNERS.has(rel)) {
      const adhocRpc = /_role\s*:\s*['"]company_admin['"]/.test(src)
        || /["']_role["']\s*:\s*["']company_admin["']/.test(src);
      if (adhocRpc) {
        violations.push({
          file: rel,
          rule: 'no-adhoc-has-role-admin',
          hint: "use requireCompanyAdmin(req) from '../_shared/adminGuard.ts'",
        });
      }
      const adhocTable = /from\(\s*['"]user_roles['"]\s*\)/.test(src)
        && /company_admin/.test(src);
      if (adhocTable) {
        violations.push({
          file: rel,
          rule: 'no-adhoc-user-roles-admin-query',
          hint: 'use requireCompanyAdmin() / listCompanyAdminIds() from _shared/adminGuard.ts',
        });
      }
    }
  }
  return violations;
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const violations = auditEdgeContracts();
  if (violations.length === 0) {
    console.log('✔ edge caller contracts clean (supabaseClients + company_admin)');
    process.exit(0);
  }
  console.error(`✘ ${violations.length} caller-contract violation(s):\n`);
  for (const v of violations) console.error(`  ${v.file}\n    [${v.rule}] ${v.hint}`);
  process.exit(1);
}
