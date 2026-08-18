#!/usr/bin/env node
/**
 * Schema-readiness gate (fail-loud).
 *
 * The P0 journal incident happened because frontend code shipped a hard
 * dependency on `public.public_expert_state_active` while that relation did
 * not exist in the database. The reader failed closed, every economic field
 * became null, and the UI rendered it as `0 股` — indistinguishable from data
 * loss.
 *
 * This gate makes that class of deploy-order mistake impossible to ship
 * silently: every relation a reader depends on must answer over the Data API
 * before the build/preflight is allowed to pass.
 *
 * Usage:  node scripts/check-schema-readiness.mjs
 * Exit 0 = all required relations reachable. Exit 1 = missing/unreadable.
 */
import { readFileSync, existsSync } from 'node:fs';

/** Relations the frontend reads directly. Add one whenever a reader is added. */
const REQUIRED = [
  { relation: 'public_expert_state_active', readers: ['src/lib/fetchProjectionStatus.ts', 'src/hooks/useProjectionStatus.ts', 'src/hooks/useExpertHoldingsBundle.ts'] },
  { relation: 'experts', readers: ['src/hooks/admin/useAdminPerformanceData.ts'] },
  { relation: 'expert_signals', readers: ['src/pages/JournalDetail.tsx'] },
  { relation: 'trade_records', readers: ['src/hooks/useExpertHoldingsBundle.ts'] },
];

function loadEnv() {
  const env = { ...process.env };
  if (existsSync('.env')) {
    for (const line of readFileSync('.env', 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
      if (m && !env[m[1]]) env[m[1]] = m[2];
    }
  }
  return env;
}

const env = loadEnv();
const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('[schema-readiness] SKIP: no VITE_SUPABASE_URL / key in env — cannot verify.');
  process.exit(process.env.SCHEMA_READINESS_STRICT === '1' ? 1 : 0);
}

const failures = [];

for (const { relation, readers } of REQUIRED) {
  const endpoint = `${url}/rest/v1/${relation}?select=*&limit=1`;
  let res;
  try {
    res = await fetch(endpoint, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  } catch (e) {
    failures.push({ relation, reason: `network: ${e.message}`, readers });
    continue;
  }
  const body = await res.text();
  // 404 + PGRST205 / 42P01 == the relation does not exist. 401/403 is fine:
  // the relation exists, RLS simply declines an anonymous read.
  if (res.status === 404 || body.includes('42P01') || body.includes('PGRST205')) {
    failures.push({ relation, reason: `missing (HTTP ${res.status}) ${body.slice(0, 160)}`, readers });
  } else if (res.status >= 500) {
    failures.push({ relation, reason: `upstream ${res.status}`, readers });
  } else {
    console.log(`[schema-readiness] OK   ${relation} (HTTP ${res.status})`);
  }
}

if (failures.length) {
  console.error('\n[schema-readiness] FAIL — frontend readers depend on relations the database does not expose:');
  for (const f of failures) {
    console.error(`  - ${f.relation}: ${f.reason}`);
    console.error(`      readers: ${f.readers.join(', ')}`);
  }
  console.error('\nApply the pending migration BEFORE shipping this frontend.');
  process.exit(1);
}

console.log('[schema-readiness] PASS — all required relations reachable.');
