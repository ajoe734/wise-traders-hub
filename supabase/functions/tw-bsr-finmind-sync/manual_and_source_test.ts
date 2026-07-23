// manual_and_source_test.ts
// 靜態源碼守門：確保幾個關鍵不變量不會隨改動被破壞。
//
// 1. manual 分支「絕不繞過 queue」——不呼叫 fetchWithRateLimit / fetch(FINMIND_URL)。
// 2. FinMind fetch 只透過 fetchWithRateLimit（唯一入口）。
// 3. refresh-data-source 的 FinMind 路徑也走 fetchWithRateLimit（全域限流）。
//
// 執行：
//   deno test --allow-read --no-check supabase/functions/tw-bsr-finmind-sync/manual_and_source_test.ts

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

const INDEX_PATH = new URL('./index.ts', import.meta.url).pathname;
const REFRESH_PATH = new URL('../refresh-data-source/index.ts', import.meta.url).pathname;

async function readFile(p: string): Promise<string> {
  return await Deno.readTextFile(p);
}

/** 粗略切段：從 `if (mode === 'manual')` 到下一個 `if (mode ===` 或 `return json({ ok: false, error: \`unknown` 之間 */
function extractManualBranch(src: string): string {
  const start = src.indexOf("mode === 'manual'");
  assert(start > -1, "manual 分支未找到");
  const rest = src.slice(start);
  const end = rest.search(/return json\(\{ ok: false, error: `unknown mode/);
  assert(end > -1, "無法定位 manual 分支結尾");
  return rest.slice(0, end);
}

Deno.test('manual 分支不直接呼叫 FinMind / fetchWithRateLimit', async () => {
  const src = await readFile(INDEX_PATH);
  const branch = extractManualBranch(src);
  // 禁止直接 fetch FinMind
  assert(!/FINMIND_URL/.test(branch), 'manual branch must not reference FINMIND_URL');
  assert(!/fetchWithRateLimit/.test(branch), 'manual branch must not call fetchWithRateLimit');
  assert(!/fetchFinmindOneDay/.test(branch), 'manual branch must not call fetchFinmindOneDay');
  // 必須經 enqueueBatch 入隊
  assert(/enqueueBatch\(/.test(branch), 'manual branch must enqueue via enqueueBatch');
});

Deno.test('FinMind fetch 只透過 fetchWithRateLimit 一個入口', async () => {
  const src = await readFile(INDEX_PATH);
  // 允許 FINMIND_URL 出現在 URLSearchParams 與 fetchWithRateLimit 呼叫中
  const rawFetchCalls = src.match(/\bfetch\s*\(\s*[`'"]https:\/\/api\.finmindtrade\.com/g) ?? [];
  assertEquals(rawFetchCalls.length, 0, `發現繞過限流器的 raw fetch → FinMind：${rawFetchCalls.length} 處`);
  // 至少要有一處 fetchWithRateLimit(supa, ...FINMIND_URL...) 呼叫
  assert(/fetchWithRateLimit\([^)]*FINMIND_URL/s.test(src),
    'tw-bsr-finmind-sync 必須至少一處 fetchWithRateLimit(FINMIND_URL,...)');
});

Deno.test('refresh-data-source 的 FinMind 呼叫也走 fetchWithRateLimit', async () => {
  const src = await readFile(REFRESH_PATH);
  // 找到 finmind fetcher 區塊：從 async function fetchFinmind 到下一個 async function
  const m = src.match(/async function fetchFinmind[\s\S]*?(?=async function |\nconst HANDLERS)/);
  assert(m, 'refresh-data-source 找不到 fetchFinmind 函式');
  const block = m[0];
  assert(/fetchWithRateLimit\(/.test(block),
    'refresh-data-source 的 FinMind 抓取必須走 fetchWithRateLimit，禁止 raw fetch()');
  assert(!/\bfetch\s*\(\s*[`'"]https:\/\/api\.finmindtrade\.com/.test(block),
    'refresh-data-source 不得直接 fetch FinMind');
});

Deno.test('enqueue 前先做 idempotency 檢查（unique on pending/running）', async () => {
  const src = await readFile(INDEX_PATH);
  // enqueueBatch 必須先查 pending/running 再 insert
  assert(/from\('tw_bsr_sync_queue'\)[\s\S]*?\.in\('status', \['pending', 'running'\]\)/s.test(src),
    'enqueueBatch 必須先查 pending/running 狀態才 insert');
});

Deno.test('worker 收到 RateLimitExhausted 應停手不再處理剩餘 job', async () => {
  const src = await readFile(INDEX_PATH);
  assert(/rateLimitedStop/.test(src), 'worker 應該有 rateLimitedStop flag');
  assert(/if \(r\.rateLimited\)/.test(src), 'worker 應根據 rateLimited 停手');
});

Deno.test('worker 不得把 FinMind 空資料或 partial raw 標成 done', async () => {
  const src = await readFile(INDEX_PATH);
  assert(/aggregated_partial/.test(src), 'worker 應辨識 aggregated_partial');
  assert(/const isIncomplete = r\.note === 'finmind_empty' \|\| r\.note === 'aggregated_empty' \|\| r\.note === 'aggregated_partial'/.test(src),
    'empty / partial 結果必須歸類為 incomplete');
  const incompleteBranch = src.match(/if \(isIncomplete[\s\S]*?\}\s*else \{/);
  assert(incompleteBranch, '找不到 incomplete 分支');
  assert(!/status:\s*'done'/.test(incompleteBranch[0]), 'incomplete 分支不得設定 status=done');
  assert(/status:\s*'pending'/.test(incompleteBranch[0]), '未達 max_attempts 的 incomplete 應回 pending');
  assert(/status:\s*'skipped'/.test(incompleteBranch[0]), '達 max_attempts 的 incomplete 應 skipped');
});
