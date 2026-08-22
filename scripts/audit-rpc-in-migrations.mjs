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
const DEBT_FILE = join(ROOT, 'scripts/rpc-known-debt.json');

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
  const found = new Map(); // name -> Set('relative/file.ts:LINE')
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const re = /\.rpc\(\s*['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const name = m[1];
      if (EXEMPT.has(name)) continue;
      const line = src.slice(0, m.index).split('\n').length;
      if (!found.has(name)) found.set(name, new Set());
      found.get(name).add(`${relative(ROOT, f)}:${line}`);
    }
  }
  return found;
}

/** 讀顯性 known-debt manifest；gate 三支被硬性禁止列入。 */
export function loadKnownDebt(file = DEBT_FILE) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { byName: new Map(), forbidden: new Set() };
  }
  const forbidden = new Set(raw.forbidden_names ?? []);
  const byName = new Map();
  for (const d of raw.debt ?? []) {
    if (forbidden.has(d.rpc)) {
      throw new Error(`[rpc-in-migrations] known-debt manifest 非法：${d.rpc} 屬於禁止清單，不得列為技術債`);
    }
    for (const k of ['rpc', 'caller', 'reason', 'discovered', 'scope_owner']) {
      if (!d[k]) throw new Error(`[rpc-in-migrations] known-debt 項目缺 ${k}: ${JSON.stringify(d)}`);
    }
    byName.set(d.rpc, d);
  }
  return { byName, forbidden };
}

/**
 * gate-specific 契約：bsrAdmissionGate.ts 呼叫的每一支 RPC 都必須有定義，
 * 且 **zero allowed missing** —— known-debt manifest 對它完全無效。
 */
export function auditGate(gateFile = 'supabase/functions/_shared/bsrAdmissionGate.ts') {
  const calls = collectRpcCalls([join(ROOT, gateFile)]);
  const defined = collectDefinedFunctions();
  const missing = [];
  for (const [name, callers] of [...calls].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!defined.has(name)) missing.push({ name, callers: [...callers].sort() });
  }
  return { names: [...calls.keys()].sort(), missing };
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
  const { byName: debtByName } = loadKnownDebt();
  const missing = [];
  const debt = [];
  for (const [name, callerSet] of [...calls].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (defined.has(name)) continue;
    const callers = [...callerSet].sort();
    const entry = debtByName.get(name);
    // 只有 manifest 的 caller file:line 精確吻合，才算已登記的技術債。
    if (entry && callers.includes(entry.caller)) debt.push({ ...entry, callers });
    else missing.push({ name, callers });
  }
  return { total: calls.size, definedCount: defined.size, missing, debt };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { total, definedCount, missing, debt } = audit();
  const gate = auditGate();
  console.log(`[rpc-in-migrations] edge RPC names=${total}, migration functions=${definedCount}, debt=${debt.length}`);
  for (const d of debt) {
    console.log(`[rpc-in-migrations] KNOWN DEBT public.${d.rpc}() ← ${d.caller} `
      + `| 發現 ${d.discovered} | owner=${d.scope_owner} | ${d.reason}`);
  }
  console.log(`[rpc-in-migrations] gate contract (bsrAdmissionGate.ts): rpcs=${gate.names.join(',')} `
    + `missing=${gate.missing.length} (allowed=0)`);
  if (gate.missing.length > 0) {
    console.error('[rpc-in-migrations] FAIL — gate RPC 缺定義，known-debt 對 gate 一律無效：');
    for (const { name, callers } of gate.missing) console.error(`  - public.${name}()  ← ${callers.join(', ')}`);
    process.exit(1);
  }
  if (missing.length === 0) {
    console.log(`[rpc-in-migrations] OK — 除 ${debt.length} 筆顯性 known debt 外，每一支 RPC 都在 migrations 有定義`);
    process.exit(0);
  }
  console.error(`[rpc-in-migrations] FAIL — ${missing.length} 支 RPC 在 migrations 找不到定義：`);
  for (const { name, callers } of missing) {
    console.error(`  - public.${name}()  ← ${callers.join(', ')}`);
  }
  process.exit(1);
}
