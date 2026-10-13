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

import { scenarioFromFundamentals } from '@/checkup/hooks/useValuationSnapshot';
describe('逐日 PS 倍數傳給站牌', () => {
  it('保留有效倍數、丟棄非正數與缺值', () => {
    const s: any = scenarioFromFundamentals({ ok: true, asOf: '2026-10-13', rows: [{ key: 'ps' } as any], psDaily: [{ ps: 5 }, { ps: 0 }, { ps: null }, { ps: 7.5 }] } as any, null);
    expect(s.psDaily).toEqual([5, 7.5]);
  });
});
