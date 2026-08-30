#!/usr/bin/env node
/**
 * Current-blob type check for the production Edge function
 * `supabase/functions/tw-chips-detail-v2/index.ts`.
 *
 * 為什麼要 sandbox：
 *   jsr:@supabase/functions-js/edge-runtime.d.ts 會 reference `npm:openai`，
 *   deno 需要一個 node_modules 才解析得到它。直接在 repo root 跑
 *   `deno check --node-modules-dir=auto` 會讓 deno 接管並重寫專案的
 *   node_modules（vitest/vite 立刻壞掉）。所以在 repo 外開一個一次性
 *   workspace，只裝這一個型別依賴，專案 node_modules 完全不受影響。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const DEFAULT_TARGETS = ['supabase/functions/tw-chips-detail-v2/index.ts'];
// 可傳入額外目標：node scripts/typecheck-edge-chips.mjs <path> [<path>...]
const TARGETS = (process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_TARGETS)
  .map((t) => resolve(process.cwd(), t));
const SANDBOX = join(tmpdir(), 'legendflow-edge-typecheck');

mkdirSync(SANDBOX, { recursive: true });
writeFileSync(join(SANDBOX, 'deno.json'), JSON.stringify({ nodeModulesDir: 'auto' }));
writeFileSync(
  join(SANDBOX, 'package.json'),
  JSON.stringify({ name: 'edge-typecheck', private: true, dependencies: { openai: '^4.52.5' } }),
);

const r = spawnSync('deno', ['check', '--no-lock', ...TARGETS], {
  cwd: SANDBOX,
  stdio: 'inherit',
});
if (r.error) {
  console.error('[typecheck:edge:chips] deno 不可用：', r.error.message);
  process.exit(1);
}
process.exit(r.status ?? 1);
