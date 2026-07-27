import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * P5 — bsrHeaderLabel 重複邏輯收斂 TDD 契約。
 *
 * 背景：ChipsSection.tsx 內含 fmtNextRun 與 bsrHeaderLabel 的完整實作，
 * 與 bsrHeaderLabel.ts 重複，容易產生文案不一致。
 * 修復契約：
 * 1. ChipsSection.tsx 必須 import bsrHeaderLabel 與 fmtNextRun from bsrHeaderLabel.ts。
 * 2. ChipsSection.tsx 內不允許存在同名的 fmtNextRun 或 bsrHeaderLabel 函式。
 * 3. bsrHeaderLabel.ts 的測試必須覆蓋所有同步狀態分支。
 */

const SECTION_FILE = resolve(__dirname, '../../../src/checkup/components/freecheckup/ChipsSection.tsx');
const LABEL_FILE = resolve(__dirname, '../../../src/checkup/components/freecheckup/bsrHeaderLabel.ts');
const TEST_FILE = resolve(__dirname, '../../../src/checkup/components/freecheckup/__tests__/bsrHeaderLabel.test.ts');

function load(p: string) {
  return readFileSync(p, 'utf-8');
}

describe('P5-A: ChipsSection 使用單一來源 bsrHeaderLabel', () => {
  it('ChipsSection.tsx 必須 import bsrHeaderLabel', () => {
    const section = load(SECTION_FILE);
    expect(section).toMatch(/from\s+['"].*bsrHeaderLabel['"]/i);
    expect(section).toMatch(/bsrHeaderLabel/i);
  });

  it('ChipsSection.tsx 不允許再定義 fmtNextRun 函式', () => {
    const section = load(SECTION_FILE);
    // 只會匹配到 import 行或呼叫；若還有 function fmtNextRun 就失敗
    const m = section.match(/function\s+fmtNextRun/g);
    expect(m).toBeNull();
  });

  it('ChipsSection.tsx 不允許再定義 bsrHeaderLabel 函式', () => {
    const section = load(SECTION_FILE);
    const m = section.match(/function\s+bsrHeaderLabel\s*\(/g);
    expect(m).toBeNull();
  });
});

describe('P5-B: bsrHeaderLabel 測試覆蓋率', () => {
  it('__tests__/bsrHeaderLabel.test.ts 必須存在並 import bsrHeaderLabel', () => {
    const test = load(TEST_FILE);
    expect(test).toMatch(/from\s+['"].*bsrHeaderLabel['"]/i);
  });

  it('__tests__/bsrHeaderLabel.test.ts 必須包含所有 status 分支的斷言', () => {
    const test = load(TEST_FILE);
    const statuses = ['running', 'pending', 'failed', 'dead', 'not_queued'];
    for (const status of statuses) {
      expect(test).toMatch(new RegExp('status:\\\s*[\'"]' + status + '[\'"]', 'i'));
    }
  });
});
