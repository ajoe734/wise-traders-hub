#!/usr/bin/env node
/**
 * L4 靜態守門 — 兩支合一：
 *  (1) LOC 硬上限：SignalRow + SignalsTable + useSignalRowViewModel + SignalListItem
 *      + SignalExpandedDetails 五檔加總 > MAX_LOC → fail。
 *  (2) 直讀原始 signal 欄位：除 useSignalRowViewModel.ts 外，
 *      任何 _adminSignals/*.tsx 直接讀 `signal.action` / `signal.currency`
 *      / `signal.price_hint` / `signal.status` / `signal.asset_class` → fail。
 *      強制新欄位必經 view model。
 *
 * 目的：防止此區塊 6 個月後又腫回 800+ 行、或散落新的 UI 條件式。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'src/pages/_adminSignals');
const CORE = [
  'SignalRow.tsx',
  'SignalsTable.tsx',
  'useSignalRowViewModel.ts',
  'SignalListItem.tsx',
  'SignalExpandedDetails.tsx',
];
const MAX_LOC = 850; // 現況 737；含 15% 成長 buffer

let fail = false;

// (1) LOC 加總
let total = 0;
const rows = CORE.map((name) => {
  const p = path.join(ROOT, name);
  const n = fs.readFileSync(p, 'utf8').split('\n').length;
  total += n;
  return [name, n];
});
rows.forEach(([n, c]) => console.log(`  ${n}: ${c}`));
console.log(`  TOTAL: ${total} / ${MAX_LOC}`);
if (total > MAX_LOC) {
  console.error(`❌ LOC 超標 (${total} > ${MAX_LOC})：請抽 helper 或收斂重複邏輯，不要放行。`);
  fail = true;
}

// (2) 禁止直讀 signal 欄位（除 view model 檔本身）
const FORBID = /\bsignal\.(action|currency|price_hint|status|asset_class)\b/g;
const files = fs.readdirSync(ROOT).filter((f) => /\.(tsx|ts)$/.test(f) && f !== 'useSignalRowViewModel.ts');
for (const f of files) {
  const full = path.join(ROOT, f);
  const src = fs.readFileSync(full, 'utf8');
  const matches = src.match(FORBID);
  // 允許在 SignalRow.tsx（table presenter）與 SignalsTable.tsx（傳遞 signal.id 用於 map key/onClick），
  // 但不允許讀被禁欄位。列出出現的次數並失敗。
  if (matches && matches.length > 0) {
    // SignalRow.tsx 目前完全用 vm，若有洩漏就要報。
    console.error(`❌ ${f} 直讀原始 signal 欄位（${matches.length} 次），請改走 view model：${matches.join(', ')}`);
    fail = true;
  }
}

if (fail) process.exit(1);
console.log('✅ admin-signals audit 通過');
