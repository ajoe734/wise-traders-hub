#!/usr/bin/env node
/**
 * F2 守衛：禁止 Edge Function 對外部 API 裸 fetch()。
 *
 * 為什麼：裸 fetch 沒有重試／退避／逾時／熔斷紀錄，是持倉抽屜籌碼資料
 * 「偶發抓不到又查不出原因」的共同根因。對外請求一律走
 * `_shared/retryFetch.ts` 的 fetchWithRetry，或已封裝它的 waterfall 模組。
 *
 * 用法：node scripts/audit-raw-fetch.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const FN_DIR = join(ROOT, 'supabase/functions');

/** 這些主機是外部資料源，必須走 fetchWithRetry。 */
const EXTERNAL_HOSTS = [
  'api.finmindtrade.com',
  'www.twse.com.tw',
  'twse.com.tw',
  'openapi.twse.com.tw',
  'mis.twse.com.tw',
  'www.tpex.org.tw',
  'tpex.org.tw',
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
  'api.polygon.io',
  'finnhub.io',
  'www.alphavantage.co',
];

/**
 * 允許裸 fetch 的檔案：retryFetch 自身（它就是實作），
 * 以及對內部 Supabase／Lovable Gateway 的呼叫（有自己的錯誤處理契約）。
 */
const ALLOWLIST = new Set([
  'supabase/functions/_shared/retryFetch.ts',
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/_test\.ts$/.test(name)) out.push(p);
  }
  return out;
}

const violations = [];

for (const file of walk(FN_DIR)) {
  const rel = relative(ROOT, file).replaceAll('\\', '/');
  if (ALLOWLIST.has(rel)) continue;
  const src = readFileSync(file, 'utf8');
  if (!/\bfetch\s*\(/.test(src)) continue;

  const lines = src.split('\n');
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    // 只抓裸 fetch(，排除 fetchWithRetry(/fetchImpl(/ .fetch(
    if (!/(^|[^.\w])fetch\s*\(/.test(line)) return;

    // 判斷這個 fetch 的 URL 是否指向外部資料源：往下看 3 行的 URL 字面值。
    const window = lines.slice(i, i + 4).join('\n');
    const host = EXTERNAL_HOSTS.find((h) => window.includes(h));
    if (!host) return;

    violations.push({ rel, line: i + 1, host, snippet: trimmed.slice(0, 110) });
  });
}

if (violations.length) {
  console.error('❌ 偵測到對外部資料源的裸 fetch()，請改用 _shared/retryFetch.ts 的 fetchWithRetry：\n');
  for (const v of violations) {
    console.error(`  ${v.rel}:${v.line}  [${v.host}]`);
    console.error(`    ${v.snippet}`);
  }
  console.error(`\n共 ${violations.length} 處違規。`);
  process.exit(1);
}

console.log('✅ 外部資料源請求皆走 fetchWithRetry（無裸 fetch）');
