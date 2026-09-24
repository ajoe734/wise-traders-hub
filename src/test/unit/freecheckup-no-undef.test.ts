/**
 * FreeCheckup 是 .jsx，tsgo 不檢查未定義名稱。2026-09-24 曾漏 import decideAutoRefresh，
 * 自動刷新每輪都丟 ReferenceError 並被 .catch 吞掉。此測以 ESLint no-undef 鎖住。
 */
import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';
import globals from 'globals';

describe('FreeCheckup .jsx 無未定義名稱', () => {
  it('no-undef = 0', async () => {
    const eslint = new ESLint({
      cwd: process.cwd(),
      overrideConfigFile: true,
      overrideConfig: [{
        files: ['**/*.{js,jsx}'],
        languageOptions: {
          ecmaVersion: 2022,
          sourceType: 'module',
          parserOptions: { ecmaFeatures: { jsx: true } },
          globals: { ...globals.browser, ...globals.es2021, process: 'readonly' },
        },
        linterOptions: { reportUnusedDisableDirectives: 'off' },
        rules: { 'no-undef': 'error' },
      }],
    });
    const res = await eslint.lintFiles([
      'src/pages/FreeCheckup.jsx',
      'src/pages/_freeCheckup/**/*.{js,jsx}',
      'src/checkup/components/CoachMarks.jsx',
    ]);
    const undef = res.flatMap(r => r.messages.filter(m => m.ruleId === 'no-undef').map(m => `${r.filePath}:${m.line} ${m.message}`));
    expect(undef).toEqual([]);
  }, 60_000);
});
