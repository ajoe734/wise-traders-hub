import { describe, it, expect } from 'vitest';
import { filterSupplyChainPeers } from '@/checkup/lib/supplyChainPeers';
import { buildLivePeerGroups } from '@/checkup/lib/livePeerGroups';
import { industryCodeOf, reviewedPeerOverride } from '@/checkup/lib/industryCodes';
import { INDUSTRIES } from '@/checkup/lib/industryTaxonomy';
import { buildPeerReference, findPeerGroup } from '@/checkup/lib/valuationStations';
import { valuationHeadlineText, multipleConfidenceText } from '@/checkup/lib/valuationScenario';
import { rankPeerCandidates } from '../../../supabase/functions/_shared/fundamentalsBasis';

const map = {
  '1815': { industries: ['玻纖紗/玻纖布'] },
  '5340': { industries: ['玻纖紗/玻纖布'] },
  glass2: { industries: ['玻纖紗/玻纖布'] },
  glass3: { industries: ['玻纖紗/玻纖布'] },
  '6274': { industries: ['CCL銅箔基板', '玻纖紗/玻纖布'] },
  ccl2: { industries: ['CCL銅箔基板'] },
  ccl3: { industries: ['CCL銅箔基板'] },
  ccl4: { industries: ['CCL銅箔基板'] },
  foil: { industries: ['銅箔'] },
  pcb: { industries: ['PCB板廠'] },
};
const rows = Object.keys(map).map((symbol) => ({ symbol, pe: symbol === '5340' ? 20 : symbol === 'glass2' ? 30 : symbol === 'glass3' ? 40 : 1000, pb: symbol === '5340' ? 2 : symbol === 'glass2' ? 3 : symbol === 'glass3' ? 4 : 100, ps: symbol === '5340' ? 3 : symbol === 'glass2' ? 4 : symbol === 'glass3' ? 5 : 200 }));
const code = industryCodeOf('玻纖紗/玻纖布');
const dirty = [{ key: 'glass', code, label: '玻纖紗/玻纖布', pickedAt: '', include: Object.keys(map), symbols: Object.keys(map), exclude: [] }];

describe('產業鏈同業估值', () => {
  it('玻纖廠不混入CCL、銅箔與PCB，也不接受次要業務匹配', () => {
    expect(filterSupplyChainPeers('1815', rows, map).map((r) => r.symbol)).toEqual(['5340', 'glass2', 'glass3']);
  });
  it('CCL只比銅箔基板廠', () => {
    expect(filterSupplyChainPeers('6274', rows, map).map((r) => r.symbol)).toEqual(['ccl2', 'ccl3', 'ccl4']);
  });
  it('人工加入也不能以次要業務繞過限制', () => {
    const o = reviewedPeerOverride({ code, key: 'glass', label: '玻纖', pickedAt: '', include: ['6274'], exclude: [], custom: true }, [{ symbol: '6274', adopted: true, codes: ['ECMP-24', 'ECMP-25'] }]);
    expect(o.exclude).toEqual(['6274']);
  });
  it('重複回傳不能重複計算同業，自己不計入', () => {
    expect(filterSupplyChainPeers('1815', [...rows, rows[1]], map).map((r) => r.symbol)).toEqual(['5340', 'glass2', 'glass3']);
  });
  it('分類未核實不借用大類或舊名單', () => {
    expect(filterSupplyChainPeers('unknown', rows, map)).toEqual([]);
    expect(findPeerGroup('1815', null, dirty)).toBeNull();
  });
  it.each(['pe', 'pb', 'ps'] as const)('%s平均只採玻纖，判讀與同一份同業結果一致', (key) => {
    const live = buildLivePeerGroups(map, dirty);
    const group = findPeerGroup('1815', '玻纖紗/玻纖布', live);
    expect(group?.symbols).toEqual(['1815', '5340', 'glass2', 'glass3']);
    const peer = buildPeerReference('1815', key, 5, rows, group);
    const expected = key === 'pe' ? 30 : key === 'pb' ? 3 : 4;
    expect(peer).toMatchObject({ status: 'ready', n: 3, avgMultiple: expected, price: expected * 5 });
    const band = { basisCount: 3, rows: [] };
    expect(valuationHeadlineText(band, true, { ruler: key, position: '在上車站附近', peer })).toContain('同業 3 家可比');
  });
  it('不足3家不跨上下游湊數，舊後端證據不能讓信心變為有同業', () => {
    const live = buildLivePeerGroups({ '1815': map['1815'], '5340': map['5340'], '6274': map['6274'], pcb: map.pcb }, dirty);
    const peer = buildPeerReference('1815', 'pe', 5, rows, findPeerGroup('1815', '玻纖紗/玻纖布', live));
    expect(peer.status).toBe('insufficient');
    const station = { ruler: 'pe' as const, position: '在上車站附近', peer };
    expect(valuationHeadlineText({ basisCount: 3, rows: [] }, true, station)).toContain('僅歷史倍數定位');
    expect(multipleConfidenceText({ rows: [{ basisOk: true, confidence: 'peer' }] as any }, station)).not.toBe('有同業證據');
  });
  it('財報服務只挑主產業相同候選，不挑次要玻纖CCL公司', () => {
    const universe = Object.entries(map).map(([symbol, row]) => ({ symbol, name: symbol, industries: row.industries }));
    expect(rankPeerCandidates({ symbol: '1815', industries: map['1815'].industries }, universe, () => null).map((r) => r.symbol).sort()).toEqual(['5340', 'glass2', 'glass3']);
  });
  it.each(INDUSTRIES)('全部129類：%s不混入任何其他主產業', (industry) => {
    const all = Object.fromEntries(INDUSTRIES.map((name, i) => [String(i), { industries: [name, industry] }]));
    const target = String(INDUSTRIES.indexOf(industry));
    all.peer = { industries: [industry] };
    const peers = Object.keys(all).map((symbol) => ({ symbol }));
    expect(filterSupplyChainPeers(target, peers, all)).toEqual([{ symbol: 'peer' }]);
    const groups = buildLivePeerGroups(all, []);
    expect(findPeerGroup(target, industry, groups)?.symbols).toEqual([target, 'peer'].sort());
    expect(rankPeerCandidates({ symbol: target, industries: [industry] }, Object.entries(all).map(([symbol, row]) => ({ symbol, name: symbol, industries: row.industries })), () => null).map((r) => r.symbol)).toEqual(['peer']);
  });
});