import { describe, it, expect } from 'vitest';
import { dominantIndustry, resolveChainClassification } from '../../../supabase/functions/_shared/chainClassification';
import { isValidIndustry } from '@/checkup/lib/industryTaxonomy';
import taxonomy from '@/checkup/data/industryTaxonomy.json';

const d = (mix: any[], source: string | null = 'annual_report') => dominantIndustry({ revenueMix: mix, source, isValidIndustry });
const G = '玻纖紗/玻纖布', C = 'CCL銅箔基板', P = 'PCB板廠';

describe('多角化主業權重公式', () => {
  it('第一名40%且領先10點 → 主業', () => expect(d([{ industry: C, pct: 40 }, { industry: G, pct: 30 }]).industry).toBe(C));
  it('第一名39.9% → 不採用', () => expect(d([{ industry: C, pct: 39.9 }, { industry: G, pct: 20 }]).industry).toBeNull());
  it('領先9.9點 → 不採用', () => expect(d([{ industry: C, pct: 45 }, { industry: G, pct: 35.1 }]).industry).toBeNull());
  it('同產業多項產品先加總再比較', () =>
    expect(d([{ industry: C, pct: 25 }, { industry: C, pct: 20 }, { industry: G, pct: 30 }]).industry).toBe(C));
  it('非年報來源（AI推估、產品比重）一律不採用', () => {
    expect(d([{ industry: C, pct: 100 }], 'ai').industry).toBeNull();
    expect(d([{ industry: C, pct: 100 }], 'product').industry).toBeNull();
    expect(d([{ industry: C, pct: 100 }], null).industry).toBeNull();
  });
  it('總和超過100或負值 → 無效', () => {
    expect(d([{ industry: C, pct: 80 }, { industry: G, pct: 30 }]).industry).toBeNull();
    expect(d([{ industry: C, pct: 60 }, { industry: G, pct: -5 }]).industry).toBeNull();
  });
  it('主業不在平台產業內 → 留待審', () => {
    const members = [{ chain: '印刷電路板', tier: '上游', subCode: 'L100', subItem: '玻璃纖維/玻纖布' }, { chain: '印刷電路板', tier: '中游', subCode: 'L630', subItem: '銅箔基板' }];
    const r = resolveChainClassification({ members, current: [P], revenueMix: [{ industry: P, pct: 90 }], revenueMixSource: 'annual_report', map: (taxonomy as any).chainSourceMap, isValidIndustry });
    expect(r.status).toBe('diversified');
  });
});
