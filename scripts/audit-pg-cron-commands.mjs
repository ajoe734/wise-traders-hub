#!/usr/bin/env node
// scripts/audit-pg-cron-commands.mjs
//
// Phase M-3b runtime auditor: every entry in cron.job MUST route HTTP
// dispatch through `public.cron_edge_call(fn, body)`. Raw `net.http_post`
// calls in cron.job.command are forbidden because they:
//   1. Leak the anon key + X-Cron-Key header literals into cron.job.command
//      (visible to anyone with cron schema read access).
//   2. Bypass the single choke-point that keeps CRON_SHARED_SECRET in sync.
//
// A cron.job command is considered COMPLIANT if it either:
//   - contains "cron_edge_call" (routed through the SECURITY DEFINER wrapper), OR
//   - contains no "net.http_post" at all (pure SQL maintenance jobs).
//
// Usage:
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_ANON_KEY=<anon> \
//   node scripts/audit-pg-cron-commands.mjs
//
// Falls back to VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY (matching
// the repo's local .env convention). Exits non-zero on any offending job so
// CI blocks the PR.

const URL_ENV = process.env.SUPABASE_URL
  ?? process.env.VITE_SUPABASE_URL
  ?? 'https://yqacmrgdjlenbijclngi.supabase.co';
const KEY_ENV = process.env.SUPABASE_ANON_KEY
  ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  ?? process.env.SUPABASE_PUBLISHABLE_KEY;

if (!KEY_ENV) {
  console.error('audit-pg-cron-commands: missing SUPABASE_ANON_KEY / VITE_SUPABASE_PUBLISHABLE_KEY');
  process.exit(2);
}

const endpoint = `${URL_ENV.replace(/\/+$/, '')}/rest/v1/rpc/admin_list_cron_jobs`;

const res = await fetch(endpoint, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    apikey: KEY_ENV,
    Authorization: `Bearer ${KEY_ENV}`,
  },
  body: '{}',
});

if (!res.ok) {
  console.error(`audit-pg-cron-commands: RPC failed ${res.status} ${await res.text()}`);
  process.exit(2);
}

const rows = await res.json();
if (!Array.isArray(rows)) {
  console.error('audit-pg-cron-commands: unexpected payload', rows);
  process.exit(2);
}

const offenders = rows.filter((r) => {
  const cmd = String(r.command ?? '');
  const hasRaw = /net\.http_post/i.test(cmd);
  const wrapped = /cron_edge_call/i.test(cmd);
  return hasRaw && !wrapped;
});

const migrated = rows.filter((r) => /cron_edge_call/i.test(String(r.command ?? ''))).length;
const sqlOnly = rows.length - migrated - offenders.length;

console.log(`pg_cron audit: total=${rows.length}  cron_edge_call=${migrated}  sql-only=${sqlOnly}  legacy=${offenders.length}`);

if (offenders.length > 0) {
  console.error('\nCron jobs still calling net.http_post directly (must route via public.cron_edge_call):');
  for (const job of offenders) {
    const preview = String(job.command).replace(/\s+/g, ' ').slice(0, 160);
    console.error(`  - #${job.jobid} ${job.jobname ?? '(unnamed)'}  ${preview}...`);
  }
  console.error('\nFix: reschedule with public.cron_edge_call(fn_name, body). See docs/security/edge-function-auth.md § M-3b.');
  process.exit(1);
}

process.exit(0);
