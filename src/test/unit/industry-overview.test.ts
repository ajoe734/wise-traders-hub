import { describe, expect, it } from 'vitest';
import {
  assembleIndustryOverview,
  filterIndustryOverview,
  type IndustryCodeRow,
  type PeerGroupRow,
} from '@/pages/company/_industryCodes/assembleIndustryOverview';
import industryCodesJson from '@/checkup/data/industryCodes.json';
import peerGroupsJson from '@/checkup/data/valuationPeerGroups.json';

const codes = (industryCodesJson as unknown as { codes: IndustryCodeRow[] }).codes;
const groups = (peerGroupsJson as unknown as { groups: PeerGroupRow[] }).groups;
// 模擬 stock_industry_map 的 industries[0] 統計結果
const counts: Record<string, number> = { IC設計: 42, 'ASIC設計服務': 7 };

const names = { '3231': '緯創', '2382': '廣達', '2454': '聯發科', '3443': '創意' };

describe('assembleIndustryOverview', () => {
  const { sections, customGroups } = assembleIndustryOverview(codes, groups, counts, names);

  it('13 大類全部出現，且涵蓋 125 個代碼', () => {
    expect(sections.length).toBe(13);
    expect(sections.reduce((n, s) => n + s.rows.length, 0)).toBe(125);
  });

  it('每個代碼只出現一次', () => {
    const all = sections.flatMap((s) => s.rows.map((r) => r.code));
    expect(new Set(all).size).toBe(all.length);
  });

  it('全市場 2531 檔的股票數加總正確', () => {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(2531);
  });

  it('ODM／伺服器是唯一的跨產業自訂組', () => {
    expect(customGroups.length).toBe(1);
    expect(customGroups[0].label).toBe('ODM／伺服器');
    expect(customGroups[0].members.length).toBe(8);
  });

  it('人工加入的成員標記為 manual，自動補齊標記為 auto', () => {
    const semi01 = sections.flatMap((s) => s.rows).find((r) => r.code === 'SEMI-01')!;
    const manual = semi01.peerGroup!.members.filter((m) => m.source === 'manual');
    const auto = semi01.peerGroup!.members.filter((m) => m.source === 'auto');
    expect(manual.length).toBe(8); // 人工確認的 8 檔
    expect(auto.length).toBeGreaterThan(0); // 自動補到 12 家
    expect(manual.map((m) => m.symbol)).toContain('2454');
  });

  it('公司名稱從 names 對應，缺名稱時為空字串', () => {
    const odm = customGroups[0];
    expect(odm.members.find((m) => m.symbol === '3231')!.name).toBe('緯創');
    expect(odm.members.find((m) => m.symbol === '2317')!.name).toBe('');
  });

  it('每個有代碼的名單都掛到對應產業列上', () => {
    const rows = sections.flatMap((s) => s.rows);
    const withGroup = rows.filter((r) => r.peerGroup !== null);
    expect(withGroup.length).toBe(123); // 124 組 - 1 自訂組
  });
});

describe('filterIndustryOverview', () => {
  const { sections, customGroups } = assembleIndustryOverview(codes, groups, counts, names);

  it('空字串不過濾', () => {
    const f = filterIndustryOverview('', sections, customGroups);
    expect(f.codes.size).toBe(0);
    expect(f.customKeys.size).toBe(0);
  });

  it('用股票代號 3231 找到 ODM／伺服器自訂組', () => {
    const f = filterIndustryOverview('3231', sections, customGroups);
    expect(f.customKeys.has('odm-server')).toBe(true);
  });

  it('用公司名稱「緯創」找到 ODM／伺服器自訂組', () => {
    const f = filterIndustryOverview('緯創', sections, customGroups);
    expect(f.customKeys.has('odm-server')).toBe(true);
  });

  it('用代碼 SEMI-01 找到 IC設計', () => {
    const f = filterIndustryOverview('semi-01', sections, customGroups);
    expect(f.codes.has('SEMI-01')).toBe(true);
  });

  it('用產業名稱「散熱」找到散熱模組', () => {
    const f = filterIndustryOverview('散熱', sections, customGroups);
    expect(f.codes.size).toBeGreaterThan(0);
  });

  it('用成員股票代號 3443 找到其所屬名單的產業列', () => {
    const f = filterIndustryOverview('3443', sections, customGroups);
    expect(f.codes.size).toBeGreaterThan(0);
  });
});
