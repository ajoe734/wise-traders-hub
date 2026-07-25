#!/usr/bin/env node
// PR-10: 重錄 chips-guardian 純函式 golden fixture。
//
// 何時要跑：
//   - guardianRules.ts 常數（SLO_* / UPSTREAM_*）合理調整
//   - 新增決策分支
// 跑法：
//   node scripts/record-guardian-golden.mjs [--check]
//
// --check：只驗證現有 fixture 是否與純函式一致，用於 CI；不寫檔。
// 無旗標：重新計算所有 case 的 expected 並寫回 fixture。
// 常數變更 PR 必附上 checklist：(1) 重跑腳本 (2) 更新 runbook §2 §6 (3) reviewer 對兩者。

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, '../supabase/functions/chips-guardian/__fixtures__/decisions.golden.json');
const RULES_PATH = resolve(__dirname, '../supabase/functions/_shared/guardianRules.ts');

// guardianRules.ts 是 Deno 風格的 ES module，無 npm deps，可直接被 Node ESM 動態 import。
const rules = await import(pathToFileURL(RULES_PATH).href);
const { decideSloAdjustment, decideUpstreamThrottle } = rules;

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
const check = process.argv.includes('--check');

let updated = 0;
let mismatched = 0;

for (const c of fixture.slo) {
  const got = decideSloAdjustment(c.input);
  if (check) {
    if (JSON.stringify(got) !== JSON.stringify(c.expected)) {
      console.error(`[SLO mismatch] ${c.name}\n  expected: ${JSON.stringify(c.expected)}\n  got:      ${JSON.stringify(got)}`);
      mismatched++;
    }
  } else if (JSON.stringify(got) !== JSON.stringify(c.expected)) {
    c.expected = got;
    updated++;
  }
}

for (const c of fixture.upstream) {
  const got = decideUpstreamThrottle(c.input);
  if (check) {
    if (JSON.stringify(got) !== JSON.stringify(c.expected)) {
      console.error(`[Upstream mismatch] ${c.name}\n  expected: ${JSON.stringify(c.expected)}\n  got:      ${JSON.stringify(got)}`);
      mismatched++;
    }
  } else if (JSON.stringify(got) !== JSON.stringify(c.expected)) {
    c.expected = got;
    updated++;
  }
}

if (check) {
  if (mismatched > 0) {
    console.error(`\n${mismatched} case(s) mismatch — 重跑 \`node scripts/record-guardian-golden.mjs\` 並檢查 runbook §2 §6。`);
    process.exit(1);
  }
  console.log(`OK: ${fixture.slo.length + fixture.upstream.length} golden case(s) 全部一致。`);
} else {
  writeFileSync(FIXTURE_PATH, JSON.stringify(fixture, null, 2) + '\n');
  console.log(`Wrote fixture; updated ${updated} case(s).`);
}
