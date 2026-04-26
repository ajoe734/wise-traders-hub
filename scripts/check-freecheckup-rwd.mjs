#!/usr/bin/env node
/**
 * FreeCheckup Hero / 持倉看板 RWD 靜態檢查
 *
 * 規則（與 mem://qa/checkup/freecheckup-mobile-regression-checklist 對齊）：
 * 1. src/pages/FreeCheckup.jsx 內所有 inline `fontSize: N`（N ≥ 32）
 *    必須同行或鄰近行帶有 className="wb-*"
 * 2. 檔案頂部 <style> 區塊必須同時存在 @media(max-width:560px) 與
 *    @media(max-width:380px) 兩個斷點
 * 3. inline `alignItems: 'flex-end'` / `justifyContent: 'flex-end'`
 *    必須在手機斷點被 override 回 flex-start
 *
 * 退出碼：0 = 通過，1 = 違規。CI 會把 stdout 全文回貼到 PR。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILE = resolve(process.cwd(), 'src/pages/FreeCheckup.jsx');
const src = readFileSync(FILE, 'utf8');
const lines = src.split('\n');

const violations = [];

// ── Rule 1：fontSize ≥ 32 必須有 wb-* className ──
// 只在 JSX inline style 物件內檢查（{ ... fontSize: N ... }），跳過 CSS 註解
// 行尾加 `// rwd-allow:reason` 可豁免（純裝飾、非數字內容）
const FONT_RE = /(?<![\w-])fontSize\s*:\s*(\d+)/g;
lines.forEach((line, idx) => {
  const trimmed = line.trim();
  // 跳過 JS / CSS 註解行
  if (trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('//')) return;
  // 行尾豁免標記
  if (/(\/\/\s*rwd-allow\b|\{\s*\/\*\s*rwd-allow\b)/.test(line)) return;

  let m;
  while ((m = FONT_RE.exec(line)) !== null) {
    const px = Number(m[1]);
    if (px < 32) continue;
    const start = Math.max(0, idx - 6);
    const end = Math.min(lines.length, idx + 7);
    const window = lines.slice(start, end).join('\n');
    if (!/className=["'`][^"'`]*\bwb-[\w-]+/.test(window)) {
      violations.push({
        line: idx + 1,
        rule: 'inline-fontSize-without-wb-class',
        detail: `fontSize: ${px} 在第 ${idx + 1} 行，但前後 ±6 行找不到 className="wb-*"。` +
                `這會導致手機斷點 media query 無法 override，造成 390/380px 溢位。` +
                `若為純裝飾、非數字內容，可在行尾加 \`// rwd-allow:reason\` 豁免。`,
        snippet: line.trim().slice(0, 140),
      });
    }
  }
});

// ── Rule 2：必要的 media query 斷點 ──
const has560 = /@media[^{]*max-width:\s*560px/.test(src);
const has380 = /@media[^{]*max-width:\s*380px/.test(src);
if (!has560) {
  violations.push({
    line: 0,
    rule: 'missing-media-560',
    detail: '檔案內找不到 @media(max-width:560px) 規則。Hero/持倉卡至少要有此斷點切單欄。',
    snippet: '',
  });
}
if (!has380) {
  violations.push({
    line: 0,
    rule: 'missing-media-380',
    detail: '檔案內找不到 @media(max-width:380px) 規則。iPhone SE 等窄機需此斷點縮字。',
    snippet: '',
  });
}

// ── Rule 3：flex-end inline 必須有手機 override ──
lines.forEach((line, idx) => {
  if (!/(alignItems|justifyContent):\s*['"`]flex-end['"`]/.test(line)) return;
  // 抓本行 className，看 <style> 區塊內 ≤560px 是否有 flex-start override
  const cls = line.match(/className=["'`]([^"'`]*)["'`]/);
  if (!cls) return;
  const wbClasses = cls[1].split(/\s+/).filter((c) => c.startsWith('wb-'));
  if (wbClasses.length === 0) return;
  const hasOverride = wbClasses.some((c) => {
    const re = new RegExp(`\\.${c}[^}]*max-width:\\s*560px[^}]*flex-start`, 's');
    return re.test(src) ||
      new RegExp(`max-width:\\s*560px[^{]*\\{[^}]*\\.${c}[^}]*flex-start`, 's').test(src);
  });
  if (!hasOverride) {
    violations.push({
      line: idx + 1,
      rule: 'flex-end-without-mobile-override',
      detail: `第 ${idx + 1} 行使用 flex-end inline style，但 wb-* class 在 ≤560px 沒有 flex-start override。` +
              `手機單欄模式下會造成內容右靠難讀。`,
      snippet: line.trim().slice(0, 140),
    });
  }
});

// ── 報告 ──
if (violations.length === 0) {
  console.log('✅ FreeCheckup RWD 靜態檢查通過');
  console.log(`   • 檢查檔案：src/pages/FreeCheckup.jsx (${lines.length} 行)`);
  console.log(`   • 規則：fontSize ≥ 32 + wb-class、@media 560/380、flex-end mobile override`);
  process.exit(0);
}

console.error('❌ FreeCheckup RWD 靜態檢查失敗（' + violations.length + ' 個違規）');
console.error('   參考規範：mem://qa/checkup/freecheckup-mobile-regression-checklist\n');
violations.forEach((v, i) => {
  console.error(`[${i + 1}] ${v.rule}` + (v.line ? `  (line ${v.line})` : ''));
  console.error(`    ${v.detail}`);
  if (v.snippet) console.error(`    > ${v.snippet}`);
  console.error('');
});
process.exit(1);
