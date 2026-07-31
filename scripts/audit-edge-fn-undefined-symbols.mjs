#!/usr/bin/env node
/**
 * Edge Function 靜態守衛：抓「用了但沒定義也沒匯入」的頂層識別字。
 * 起因：apply-auth-guards codemod 曾刪掉 index.ts 內的 `const corsHeaders`，
 * 卻沒補 import，造成 chips-guardian / tw-bsr-window-converge 執行期
 * `ReferenceError: corsHeaders is not defined`（HTTP 500）。
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'supabase/functions';
// 只掃常見共用符號：這些都是「本地宣告或從 _shared 匯入」二選一
const SYMBOLS = [
  'corsHeaders',
  'serviceClient',
  'anonClient',
  'requireCronKey',
  'requireUser',
  'AuthError',
];

const failures = [];
for (const dir of readdirSync(ROOT, { withFileTypes: true })) {
  if (!dir.isDirectory() || dir.name.startsWith('_')) continue;
  for (const file of ['index.ts', 'lib.ts']) {
    const path = join(ROOT, dir.name, file);
    if (!existsSync(path)) continue;
    const src = readFileSync(path, 'utf8');
    for (const sym of SYMBOLS) {
      if (!new RegExp(`\\b${sym}\\b`).test(src)) continue;
      const declared = new RegExp(
        `(?:const|let|var|function|class)\\s+${sym}\\b|` +
        `import\\s*\\{[^}]*\\b${sym}\\b[^}]*\\}\\s*from|` +
        `\\b${sym}\\s*[:,]?[^\\n]*\\}\\s*=\\s*|` +
        `\\(\\s*[^)]*\\b${sym}\\b[^)]*\\)\\s*(?:=>|\\{)`,
        'm',
      ).test(src);
      if (!declared) failures.push(`${path}: 使用了 ${sym} 但未定義也未匯入`);
    }
  }
}

if (failures.length) {
  console.error('❌ Edge Function 未定義符號：');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('✅ Edge Function 共用符號皆有定義或匯入');
