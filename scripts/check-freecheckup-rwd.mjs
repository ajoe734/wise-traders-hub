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
 * 退出碼：0 = 通過，1 = 違規。
 *
 * 輸出：
 *   - stdout：人類可讀的條列報告（CI 會抓取回貼 PR）
 *   - --json <path>：結構化違規報告（含建議修正、可給 Review API 標註用）
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const args = process.argv.slice(2);
const jsonIdx = args.indexOf('--json');
const jsonOut = jsonIdx >= 0 ? args[jsonIdx + 1] : null;

const REL_FILE = 'src/pages/FreeCheckup.jsx';
const FILE = resolve(process.cwd(), REL_FILE);
const src = readFileSync(FILE, 'utf8');
const lines = src.split('\n');

/** @type {{file:string,line:number,rule:string,severity:'error',detail:string,snippet:string,suggestion?:string}[]} */
const violations = [];

const buildSuggestion = (rule, line, px) => {
  switch (rule) {
    case 'inline-fontSize-without-wb-class':
      return [
        `// 為這段 inline fontSize: ${px} 加上 wb-* class，並在頂部 <style> 加 @media override：`,
        `// 1) JSX：`,
        `//   <span className="wb-card-pnl-num" style={{ fontSize: ${px}, ... }}>...</span>`,
        `// 2) <style> block 加入：`,
        `//   @media (max-width: 560px) { .wb-card-pnl-num { font-size: ${Math.max(32, Math.round(px * 0.65))}px !important; } }`,
        `//   @media (max-width: 380px) { .wb-card-pnl-num { font-size: ${Math.max(28, Math.round(px * 0.5))}px !important; } }`,
        `// 若為純裝飾、非數字內容可在行尾加 \`// rwd-allow:reason\` 豁免`,
      ].join('\n');
    case 'flex-end-without-mobile-override':
      return [
        `// 在 <style> block 內，為這個 wb-* class 加上手機 override：`,
        `// @media (max-width: 560px) {`,
        `//   .wb-XXX { align-items: flex-start !important; justify-content: flex-start !important; }`,
        `// }`,
      ].join('\n');
    case 'missing-media-560':
      return `/* 在 <style> 區塊新增 */\n@media (max-width: 560px) {\n  /* 將 hero-grid 切單欄、KPI 改 2x2、縮放大字 */\n}`;
    case 'missing-media-380':
      return `/* 在 <style> 區塊新增 */\n@media (max-width: 380px) {\n  /* iPhone SE：再縮一級 PnL 字級 */\n}`;
    default:
      return undefined;
  }
};

const push = (v) => {
  violations.push({
    file: REL_FILE,
    severity: 'error',
    ...v,
    suggestion: v.suggestion ?? buildSuggestion(v.rule, v.line, v.px),
  });
};

// ── Rule 1：fontSize ≥ 32 必須有 wb-* className ──
const FONT_RE = /(?<![\w-])fontSize\s*:\s*(\d+)/g;
lines.forEach((line, idx) => {
  const trimmed = line.trim();
  if (trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('//')) return;
  if (/(\/\/\s*rwd-allow\b|\{\s*\/\*\s*rwd-allow\b|\/\*\s*rwd-allow\b)/.test(line)) return;

  let m;
  while ((m = FONT_RE.exec(line)) !== null) {
    const px = Number(m[1]);
    if (px < 32) continue;
    const start = Math.max(0, idx - 6);
    const end = Math.min(lines.length, idx + 7);
    const window = lines.slice(start, end).join('\n');
    if (!/className=["'`][^"'`]*\bwb-[\w-]+/.test(window)) {
      push({
        line: idx + 1,
        px,
        rule: 'inline-fontSize-without-wb-class',
        detail:
          `fontSize: ${px} 在第 ${idx + 1} 行，但前後 ±6 行找不到 className="wb-*"。` +
          `這會導致手機斷點 media query 無法 override，造成 390/380px 溢位。` +
          `若為純裝飾、非數字內容，可在行尾加 \`// rwd-allow:reason\` 豁免。`,
        snippet: line.trim().slice(0, 140),
      });
    }
  }
});

// ── Rule 2：必要的 media query 斷點 ──
if (!/@media[^{]*max-width:\s*560px/.test(src)) {
  push({
    line: 1,
    rule: 'missing-media-560',
    detail: '檔案內找不到 @media(max-width:560px) 規則。Hero/持倉卡至少要有此斷點切單欄。',
    snippet: '',
  });
}
if (!/@media[^{]*max-width:\s*380px/.test(src)) {
  push({
    line: 1,
    rule: 'missing-media-380',
    detail: '檔案內找不到 @media(max-width:380px) 規則。iPhone SE 等窄機需此斷點縮字。',
    snippet: '',
  });
}

// ── Rule 3：flex-end inline 必須有手機 override ──
lines.forEach((line, idx) => {
  if (!/(alignItems|justifyContent):\s*['"`]flex-end['"`]/.test(line)) return;
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
    push({
      line: idx + 1,
      rule: 'flex-end-without-mobile-override',
      detail:
        `第 ${idx + 1} 行使用 flex-end inline style，但 wb-* class (${wbClasses.join(', ')}) 在 ≤560px 沒有 flex-start override。` +
        `手機單欄模式下會造成內容右靠難讀。`,
      snippet: line.trim().slice(0, 140),
    });
  }
});

// ── 輸出 JSON 報告 ──
if (jsonOut) {
  mkdirSync(dirname(jsonOut), { recursive: true });
  writeFileSync(
    jsonOut,
    JSON.stringify(
      {
        tool: 'check-freecheckup-rwd',
        file: REL_FILE,
        totalLines: lines.length,
        passed: violations.length === 0,
        violations,
      },
      null,
      2
    )
  );
}

// ── stdout 報告 ──
if (violations.length === 0) {
  console.log('✅ FreeCheckup RWD 靜態檢查通過');
  console.log(`   • 檢查檔案：${REL_FILE} (${lines.length} 行)`);
  console.log(`   • 規則：fontSize ≥ 32 + wb-class、@media 560/380、flex-end mobile override`);
  process.exit(0);
}

console.error('❌ FreeCheckup RWD 靜態檢查失敗（' + violations.length + ' 個違規）');
console.error('   參考規範：mem://qa/checkup/freecheckup-mobile-regression-checklist\n');
violations.forEach((v, i) => {
  console.error(`[${i + 1}] ${v.rule}  (${v.file}:${v.line})`);
  console.error(`    ${v.detail}`);
  if (v.snippet) console.error(`    > ${v.snippet}`);
  if (v.suggestion) {
    console.error(`    建議修正：`);
    v.suggestion.split('\n').forEach((s) => console.error(`      ${s}`));
  }
  console.error('');
});
process.exit(1);
