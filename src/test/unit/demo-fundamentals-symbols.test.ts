import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEMO_FUNDAMENTALS_SYMBOLS } from '../../../supabase/functions/_shared/demoFundamentalsSymbols';

describe('範例持股財報免登入名單', () => {
  it('與範例資料的持股代碼完全一致（不多開放任何代碼）', () => {
    const src = readFileSync('src/checkup/data/demoData.js', 'utf8');
    const codes = [...new Set([...src.matchAll(/code:\s*'(\d{4,6})'/g)].map((m) => m[1]))].sort();
    expect([...DEMO_FUNDAMENTALS_SYMBOLS].sort()).toEqual(codes);
  });
});
