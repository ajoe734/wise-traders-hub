/**
 * i18n 回歸測試 — 透過 vitest 驅動 scripts/check-freecheckup-i18n.mjs
 *
 * 任務：每次跑 `bun run test:run` 都會自動掃 FreeCheckup.jsx，
 * 確保未來新增的 UI 不會偷塞英文字串進正式繁中畫面。
 *
 * 對應規範：
 *   - 工具：scripts/check-freecheckup-i18n.mjs
 *   - 工作流：.github/workflows/freecheckup-rwd.yml（新增 i18n 任務）
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(process.cwd(), 'scripts/check-freecheckup-i18n.mjs');
const TARGET = resolve(process.cwd(), 'src/pages/FreeCheckup.jsx');

/** 跑 scanner 並回傳 { code, stdout, stderr, json? } */
function runScanner(jsonOutPath?: string) {
  const args = [SCRIPT];
  if (jsonOutPath) args.push('--json', jsonOutPath);
  try {
    const stdout = execFileSync('node', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout, stderr: '' };
  } catch (e: any) {
    return {
      code: e.status ?? 1,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
    };
  }
}

describe('FreeCheckup i18n 回歸（持倉看板必須 100% 繁中或白名單）', () => {
  beforeAll(() => {
    expect(existsSync(SCRIPT), 'i18n scanner 腳本應存在').toBe(true);
    expect(existsSync(TARGET), 'FreeCheckup.jsx 應存在').toBe(true);
  });

  it('現行 FreeCheckup.jsx 通過 i18n 檢查（baseline 必須綠）', () => {
    const tmpJson = join(mkdtempSync(join(tmpdir(), 'i18n-')), 'report.json');
    const { code, stdout, stderr } = runScanner(tmpJson);
    if (code !== 0) {
      // 失敗時把 scanner 的訊息一起拋出，方便定位
      throw new Error(
        [
          `scanner 退出碼 ${code}（預期 0）`,
          '',
          '--- stderr ---',
          stderr,
          '--- stdout ---',
          stdout,
        ].join('\n')
      );
    }
    expect(code).toBe(0);
    expect(stdout).toMatch(/✅\s*FreeCheckup i18n 檢查通過/);

    // 驗證 JSON 報告結構
    const report = JSON.parse(readFileSync(tmpJson, 'utf8'));
    expect(report.tool).toBe('check-freecheckup-i18n');
    expect(report.passed).toBe(true);
    expect(report.violations).toEqual([]);
    expect(report.allowlistSize).toBeGreaterThan(0);
  });

  it('能阻擋新引入的英文字串（注入測試）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'i18n-inject-'));
    const backup = join(dir, 'FreeCheckup.bak.jsx');
    copyFileSync(TARGET, backup);
    try {
      const original = readFileSync(TARGET, 'utf8');
      const injected = original.replace(
        'export default',
        `/* i18n-test-injection */
const _i18nFakeFixture = (
  <div>
    <span>Click to refresh your portfolio now</span>
    <input placeholder="Type your message here" />
  </div>
);
export default`
      );
      writeFileSync(TARGET, injected);

      const tmpJson = join(dir, 'report.json');
      const { code, stdout } = runScanner(tmpJson);
      expect(code, '注入英文後 scanner 必須失敗').toBe(1);

      const report = JSON.parse(readFileSync(tmpJson, 'utf8'));
      expect(report.passed).toBe(false);
      const texts = report.violations.map((v: any) => v.text);
      expect(texts).toContain('Click to refresh your portfolio now');
      expect(texts).toContain('Type your message here');
      expect(stdout + report.violations.map((v: any) => v.detail).join(' ')).toMatch(
        /未翻譯英文|i18n/
      );
    } finally {
      copyFileSync(backup, TARGET);
    }
  });

  it('i18n-allow 註解能正確豁免緊接的下一行（不會誤豁免後續行）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'i18n-allow-'));
    const backup = join(dir, 'FreeCheckup.bak.jsx');
    copyFileSync(TARGET, backup);
    try {
      const original = readFileSync(TARGET, 'utf8');
      const injected = original.replace(
        'export default',
        `/* i18n-test-injection */
const _i18nFakeFixture = (
  <div>
    {/* i18n-allow:test-fixture 此豁免只應作用於緊接的下一行 */}
    <span>Allowed decorative label</span>
    <input placeholder="Should still be flagged" />
  </div>
);
export default`
      );
      writeFileSync(TARGET, injected);

      const tmpJson = join(dir, 'report.json');
      const { code } = runScanner(tmpJson);
      expect(code, '下下行的英文應仍被擋下').toBe(1);

      const report = JSON.parse(readFileSync(tmpJson, 'utf8'));
      const texts = report.violations.map((v: any) => v.text);
      expect(texts).not.toContain('Allowed decorative label');
      expect(texts).toContain('Should still be flagged');
    } finally {
      copyFileSync(backup, TARGET);
    }
  });

  it('白名單能放行純由白名單詞組成的英文（如 TODAY P&L、PORTFOLIO OVERVIEW）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'i18n-allow-list-'));
    const backup = join(dir, 'FreeCheckup.bak.jsx');
    copyFileSync(TARGET, backup);
    try {
      const original = readFileSync(TARGET, 'utf8');
      const injected = original.replace(
        'export default',
        `/* i18n-test-injection */
const _i18nFakeFixture = (
  <div>
    <span>TODAY P&L</span>
    <span>PORTFOLIO OVERVIEW</span>
    <span>THESIS · 進場理由</span>
  </div>
);
export default`
      );
      writeFileSync(TARGET, injected);

      const { code } = runScanner();
      expect(code, '白名單與含 CJK 的字串應被放行').toBe(0);
    } finally {
      copyFileSync(backup, TARGET);
    }
  });

  it('能擋下 a11y 屬性（aria-describedby / aria-roledescription）內的英文文案', () => {
    const dir = mkdtempSync(join(tmpdir(), 'i18n-a11y-'));
    const backup = join(dir, 'FreeCheckup.bak.jsx');
    copyFileSync(TARGET, backup);
    try {
      const original = readFileSync(TARGET, 'utf8');
      const injected = original.replace(
        'export default',
        `/* i18n-test-injection */
const _i18nFakeFixture = (
  <div>
    <button aria-describedby="Open the holdings drawer">x</button>
    <span aria-roledescription="Interactive widget">y</span>
    {/* aria-describedby 為 ID 引用（kebab）→ 應放行 */}
    <div aria-describedby="holdings-drawer-tip">z</div>
  </div>
);
export default`
      );
      writeFileSync(TARGET, injected);

      const tmpJson = join(dir, 'report.json');
      const { code } = runScanner(tmpJson);
      expect(code, 'a11y 內含英文文案應被擋下').toBe(1);

      const report = JSON.parse(readFileSync(tmpJson, 'utf8'));
      const texts = report.violations.map((v: any) => v.text);
      expect(texts).toContain('Open the holdings drawer');
      expect(texts).toContain('Interactive widget');
      // 純 ID 字串不該被誤殺
      expect(texts).not.toContain('holdings-drawer-tip');
    } finally {
      copyFileSync(backup, TARGET);
    }
  });

  it('能擋下視覺 data-* 屬性（data-tooltip / data-hint）內的英文文案', () => {
    const dir = mkdtempSync(join(tmpdir(), 'i18n-data-'));
    const backup = join(dir, 'FreeCheckup.bak.jsx');
    copyFileSync(TARGET, backup);
    try {
      const original = readFileSync(TARGET, 'utf8');
      const injected = original.replace(
        'export default',
        `/* i18n-test-injection */
const _i18nFakeFixture = (
  <div>
    <button data-tooltip="Refresh portfolio">x</button>
    <span data-hint="Click to expand">y</span>
    {/* data-state 是行為旗標，不該被誤殺 */}
    <div data-state="open">z</div>
  </div>
);
export default`
      );
      writeFileSync(TARGET, injected);

      const tmpJson = join(dir, 'report.json');
      const { code } = runScanner(tmpJson);
      expect(code, '視覺 data-* 內含英文文案應被擋下').toBe(1);

      const report = JSON.parse(readFileSync(tmpJson, 'utf8'));
      const texts = report.violations.map((v: any) => v.text);
      expect(texts).toContain('Refresh portfolio');
      expect(texts).toContain('Click to expand');
      expect(texts).not.toContain('open');
    } finally {
      copyFileSync(backup, TARGET);
    }
  });

  it('能擋下 <button>/<option> 內字面量英文（含三元運算字串）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'i18n-btn-'));
    const backup = join(dir, 'FreeCheckup.bak.jsx');
    copyFileSync(TARGET, backup);
    try {
      const original = readFileSync(TARGET, 'utf8');
      const injected = original.replace(
        'export default',
        `/* i18n-test-injection */
const _i18nFakeFixture = (
  <div>
    <button>{cond ? "Save changes" : "Cancel action"}</button>
    <option value="x">Apply filter</option>
  </div>
);
export default`
      );
      writeFileSync(TARGET, injected);

      const tmpJson = join(dir, 'report.json');
      const { code } = runScanner(tmpJson);
      expect(code, '<button>/<option> 內字面量英文應被擋下').toBe(1);

      const report = JSON.parse(readFileSync(tmpJson, 'utf8'));
      const texts = report.violations.map((v: any) => v.text);
      expect(texts).toContain('Save changes');
      expect(texts).toContain('Cancel action');
      expect(texts).toContain('Apply filter');
    } finally {
      copyFileSync(backup, TARGET);
    }
  });
});
