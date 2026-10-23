import { describe, it, expect } from 'vitest';
import { buildLivePeerGroups } from '@/checkup/lib/livePeerGroups';
import { findPeerGroup } from '@/checkup/lib/valuationStations';
import { industryCodeOf } from '@/checkup/lib/industryCodes';
import { validateReview, reviewCsv } from '@/lib/stockIndustryReview';

describe('人工分類即時同業', () => {
  it('富喬只進玻纖同業，修正後立刻移出PCB板廠，不帶待審成員', () => {
    const groups = [{ key: 'pcb', code: industryCodeOf('PCB板廠'), label: 'PCB板廠', pickedAt: '', symbols: ['1815', '3044', 'pending'], include: ['1815', '3044', 'pending'], exclude: [] }];
    const live = buildLivePeerGroups({ '1815': { industries: ['玻纖紗/玻纖布'] }, '5340': { industries: ['玻纖紗/玻纖布'] }, '3044': { industries: ['PCB板廠'] } }, groups);
    expect(findPeerGroup('1815', '玻纖紗/玻纖布', live)?.symbols).toEqual(['1815', '5340']);
    expect(findPeerGroup('3044', 'PCB板廠', live)?.symbols).toEqual(['3044']);
    expect(live.flatMap((g) => g.symbols)).not.toContain('pending');
  });
  it('人工排除優先，跨產業自訂組仍排除未採用者', () => {
    const map = { '1815': { industries: ['玻纖紗/玻纖布'] }, '5340': { industries: ['玻纖紗/玻纖布'] } };
    const live = buildLivePeerGroups(map, [{ key: 'custom', custom: true, label: '自訂', pickedAt: '', symbols: ['1815', '5340', '9999'], exclude: ['5340'] }]);
    expect(live.find((g) => g.custom)?.symbols).toEqual(['1815']);
  });
  it('未有已採用分類不能回退舊名單', () => expect(buildLivePeerGroups({}, [{ key: 'old', code: industryCodeOf('PCB板廠'), label: 'PCB板廠', pickedAt: '', symbols: ['1815'] }])).toEqual([]));
  it('拒絕旧混合類別PCB/CCL，接受玻纖紗/玻纖布', () => {
    expect(validateReview(['PCB/CCL'], [])).not.toBeNull();
    expect(validateReview(['玻纖紗/玻纖布'], [])).toBeNull();
  });
  it('全部752筆匯出不因搜尋或頁面上限漏列', () => {
    const rows = Array.from({ length: 752 }, (_, i) => ({ symbol: String(1000 + i), name: `公司${i}` }));
    const csv = reviewCsv(rows);
    expect(csv.split('\r\n')).toHaveLength(753);
    expect(csv).toContain('"1751","公司751"');
  });
});