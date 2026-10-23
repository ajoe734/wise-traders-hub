import { describe, it, expect } from 'vitest';
import { buildChainReview } from '../../../supabase/functions/_shared/chainRefreshCore';
import { resolveChainClassification } from '../../../supabase/functions/_shared/chainClassification';
import { isAdoptedClassification, isValidIndustry } from '@/checkup/lib/industryTaxonomy';
import taxonomy from '@/checkup/data/industryTaxonomy.json';

const members = [{ symbol: '1815', chain: '印刷電路板', tier: '上游', subCode: 'L100', subItem: '玻璃纖維/玻纖布' }];
const options = { members, map: taxonomy.chainSourceMap, isValidIndustry, isAdoptedClassification };

describe('每月產業鏈重審', () => {
  it('全部600檔待審都產生結果，不受頁面或批次上限截斷', () => {
    const rows = Array.from({ length: 600 }, (_, i) => ({ symbol: String(1000 + i), industries: ['玻纖紗/玻纖布'], reviewed: false, confidence: 0.5 }));
    const r = buildChainReview({ ...options, rows });
    expect(r.results).toHaveLength(600);
    expect(new Set(r.results.map(x => x.symbol)).size).toBe(600);
    expect(r.counts.adopted).toBe(1);
    expect(r.counts.no_source).toBe(599);
  });
  it('新符合的玻纖證據自動採用，但不覆蓋人工確認或已採用的分類', () => {
    const r = buildChainReview({ ...options, rows: [
      { symbol: '1815', industries: ['玻纖紗/玻纖布'], reviewed: false },
      { symbol: '5340', industries: ['玻纖紗/玻纖布'], reviewed: true },
      { symbol: '5475', industries: ['玻纖紗/玻纖布'], reviewed: false, confidence: 0.95, evidence: '官方主要經營業務' },
    ] });
    expect(r.results.map(x => x.symbol)).toEqual(['1815']);
    expect(r.results[0].industry).toBe('玻纖紗/玻纖布');
    expect(r.skipped).toBe(2);
  });
  it('新平台代碼若子項名稱完全符合既有核准對照，可自動加入既有產業', () => {
    const r = buildChainReview({ ...options, members: [{ ...members[0], subCode: 'NEW100' }], rows: [{ symbol: '1815', industries: ['玻纖紗/玻纖布'] }] });
    expect(r.results[0].status).toBe('adopted');
    expect(r.results[0].industry).toBe('玻纖紗/玻纖布');
  });
  it('未知子項不能自創分類，列出完整未對照清單', () => {
    const r = buildChainReview({ ...options, members: [{ ...members[0], subCode: 'NEW', subItem: '未知產品' }], rows: [{ symbol: '1815', industries: ['玻纖紗/玻纖布'] }] });
    expect(r.results[0].status).toBe('unmapped');
    expect(r.unmapped).toEqual([{ subCode: 'NEW', subItem: '未知產品' }]);
  });
  it('多角化用實際最大營收項，不依輸入陣列順序', () => {
    const r = resolveChainClassification({ members: [members[0], { ...members[0], subCode: 'L630', subItem: '銅箔基板' }], current: ['玻纖紗/玻纖布'], revenueMix: [{ industry: '玻纖紗/玻纖布', pct: 20 }, { industry: 'CCL銅箔基板', pct: 80 }], map: taxonomy.chainSourceMap, isValidIndustry });
    expect(r.industry).toBe('CCL銅箔基板');
  });
  it.each([NaN, -1, 0, Infinity])('無效營收比重 %s 不得自動採用', pct => {
    const r = resolveChainClassification({ members: [members[0], { ...members[0], subCode: 'L630', subItem: '銅箔基板' }], current: ['玻纖紗/玻纖布'], revenueMix: [{ industry: 'CCL銅箔基板', pct }], map: taxonomy.chainSourceMap, isValidIndustry });
    expect(r.status).toBe('diversified');
  });
  it('最大營收並列不同主業時保持待審', () => {
    const r = resolveChainClassification({ members: [members[0], { ...members[0], subCode: 'L630', subItem: '銅箔基板' }], current: ['玻纖紗/玻纖布'], revenueMix: [{ industry: '玻纖紗/玻纖布', pct: 50 }, { industry: 'CCL銅箔基板', pct: 50 }], map: taxonomy.chainSourceMap, isValidIndustry });
    expect(r.status).toBe('diversified');
  });
});