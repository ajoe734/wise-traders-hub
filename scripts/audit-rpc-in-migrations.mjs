#!/usr/bin/env node
/**
 * Stage 0 守衛：Edge Function 呼叫的每一支 public RPC 都必須在 supabase/migrations/ 有定義。
 *
 * 為什麼：2026-08 事故 — Stage B 版 `tw-bsr-finmind-sync` 已部署到 production，
 * 但 Stage B 的 SQL 只在 clone 排練過、從未進 migrations。結果每次 worker 都以
 * `admission_status_rpc_error: Could not find the function public.bsr_admission_status`
 * fail-closed，HTTP 200、claimed=0，cron 全綠但背景回補 5 天零產出。
 *
 * 這個 audit 讓「部署漂移」在 CI 就紅，而不是靠人去讀 pg_net response body。
 *
 * 用法：node scripts/audit-rpc-in-migrations.mjs
 * 退出碼：0 = 全部有定義；1 = 有 RPC 找不到定義。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const FN_DIR = join(ROOT, 'supabase/functions');
const MIG_DIR = join(ROOT, 'supabase/migrations');

/**
 * 這些名稱不是 public schema 的 RPC（或由 Supabase 平台提供），不納入檢查。
 * 每一筆都必須寫理由，禁止拿來當「跳過紅燈」的後門。
 */
const EXEMPT = new Set([
  // 由 pg_graphql / postgrest 內建，不在 migrations
  'graphql',
]);

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|js|mjs)$/.test(e)) out.push(p);
  }
  return out;
}

/** 從 edge function 原始碼抓 `.rpc('name'` / `.rpc("name"` 的字面量。 */
export function collectRpcCalls(files) {
  const found = new Map(); // name -> Set(relative file)
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const re = /\.rpc\(\s*['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const name = m[1];
      if (EXEMPT.has(name)) continue;
      if (!found.has(name)) found.set(name, new Set());
      found.get(name).add(relative(ROOT, f));
    }
  }
  return found;
}

/** 掃 migrations 目錄，收集所有被 CREATE 的 public function 名稱。 */
export function collectDefinedFunctions(dir = MIG_DIR) {
  const defined = new Set();
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  } catch {
    return defined;
  }
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*\(/gi;
  for (const f of files) {
    const src = readFileSync(join(dir, f), 'utf8');
    let m;
    while ((m = re.exec(src)) !== null) defined.add(m[1]);
  }
  return defined;
}

export function audit() {
  const calls = collectRpcCalls(walk(FN_DIR));
  const defined = collectDefinedFunctions();
  const missing = [];
  for (const [name, callers] of [...calls].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!defined.has(name)) missing.push({ name, callers: [...callers].sort() });
  }
  return { total: calls.size, definedCount: defined.size, missing };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { total, definedCount, missing } = audit();
  console.log(`[rpc-in-migrations] edge RPC names=${total}, migration functions=${definedCount}`);
  if (missing.length === 0) {
    console.log('[rpc-in-migrations] OK — 每一支 RPC 都在 supabase/migrations/ 有定義');
    process.exit(0);
  }
  console.error(`[rpc-in-migrations] FAIL — ${missing.length} 支 RPC 在 migrations 找不到定義：`);
  for (const { name, callers } of missing) {
    console.error(`  - public.${name}()  ← ${callers.join(', ')}`);
  }
  process.exit(1);
}
