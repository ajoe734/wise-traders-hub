import { describe, it, expect } from 'vitest';
import taxonomy from '@/checkup/data/industryTaxonomy.json';
import denoTaxonomy from '../../../supabase/functions/_shared/industryTaxonomy.json';
import { resolveChainClassification, type ChainSourceMap } from '../../../supabase/functions/_shared/chainClassification';
import { isValidIndustry } from '@/checkup/lib/industryTaxonomy';

const map = (taxonomy as any).chainSourceMap as ChainSourceMap;
const pcb = (subCode: string, subItem: string, tier = '上游') => ({ chain: '印刷電路板', tier, subCode, subItem });
const run = (members: any[], current: string[], revenueMix?: any) =>
  resolveChainClassification({ members, current, revenueMix, revenueMixSource: 'annual_report', map, isValidIndustry });

describe('產業價值鏈自動分類', () => {
  it('前後端字典對照表一致', () => expect((denoTaxonomy as any).chainSourceMap).toEqual(map));
  it('對照表只指向字典內產業', () => {
    for (const v of Object.values(map)) expect(isValidIndustry(v.industry)).toBe(true);
  });
  it('平台玻纖布對到玻纖紗/玻纖布、銅箔基板對到CCL', () => {
    expect(map.L100.industry).toBe('玻纖紗/玻纖布');
    expect(map.L630.industry).toBe('CCL銅箔基板');
    expect(map.L400.industry).toBe('銅箔');
  });
  it('富喬：平台與主業一致 → 自動上線並寫依據', () => {
    const r = run([pcb('L100', '玻璃纖維/玻纖布')], ['玻纖紗/玻纖布']);
    expect(r.status).toBe('adopted');
    expect(r.industry).toBe('玻纖紗/玻纖布');
    expect(r.evidence).toBe('產業價值鏈：印刷電路板 上游 玻璃纖維/玻纖布');
  });
  it('平台產業只是次要業務 → 衝突留待審', () =>
    expect(run([pcb('L100', '玻璃纖維/玻纖布')], ['玻璃陶瓷', '玻纖紗/玻纖布']).status).toBe('conflict'));
  it('完全不一致 → 衝突', () => expect(run([pcb('L630', '銅箔基板', '中游')], ['PCB板廠']).status).toBe('conflict'));
  it('南亞多角化、無營收比重 → 待審', () =>
    expect(run([pcb('L100', '玻璃纖維/玻纖布'), pcb('L400', '銅箔'), pcb('L630', '銅箔基板', '中游')], ['塑化']).status).toBe('diversified'));
  it('多角化但營收比重第一名在平台內 → 依營收上線', () => {
    const r = run([pcb('L400', '銅箔'), pcb('L630', '銅箔基板', '中游')], ['CCL銅箔基板'], [{ industry: 'CCL銅箔基板', pct: 70 }]);
    expect(r.status).toBe('adopted');
    expect(r.industry).toBe('CCL銅箔基板');
  });
  it('對照不到的子項被丟棄', () => expect(run([{ chain: '人工智慧', tier: null, subCode: '5350', subItem: '機器學習' }], ['IC設計']).status).toBe('unmapped'));
  it('平台未收錄 → 來源沒有', () => expect(run([], ['IC設計']).status).toBe('no_source'));
});
