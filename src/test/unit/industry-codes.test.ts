import { describe, it, expect } from 'vitest';
import { INDUSTRY_CODES, assignCodes, industryCodeOf, composePeerSymbols, type IndustryCode } from '@/checkup/lib/industryCodes';
import { INDUSTRIES } from '@/checkup/lib/industryTaxonomy';
import { PEER_GROUPS, findPeerGroup, buildPeerReference } from '@/checkup/lib/valuationStations';

describe('產業代碼表', () => {
  it('字典 129 個細分產業全部有唯一代碼', () => {
    const live = INDUSTRY_CODES.filter((c) => !c.retired);
    expect(INDUSTRIES.length).toBe(129);
    expect(new Set(live.map((c) => c.code)).size).toBe(129);
    for (const n of INDUSTRIES) expect(industryCodeOf(n)).not.toBeNull();
  });
  it('全形斜線、空白寫法對應同一代碼', () => {
    expect(industryCodeOf('PCB／CCL')).toBe(industryCodeOf('PCB/CCL'));
    expect(industryCodeOf(' ASIC設計服務 ')).toBe(industryCodeOf('ASIC設計服務'));
  });
  it('對不到不猜，回 null', () => expect(industryCodeOf('不存在產業')).toBeNull());
  it('改名保留代碼、舊名進別名；移除不重用', () => {
    const prev: IndustryCode[] = [
      { code: 'SEMI-01', name: '甲', sector: '半導體', sectorCode: 'SEMI', aliases: [] },
      { code: 'SEMI-02', name: '乙', sector: '半導體', sectorCode: 'SEMI', aliases: ['乙二'] },
    ];
    const out = assignCodes({ 半導體: ['乙二', '丙'] }, { 半導體: 'SEMI' }, prev);
    expect(out.find((c) => c.code === 'SEMI-02')?.name).toBe('乙二');
    expect(out.find((c) => c.code === 'SEMI-02')?.aliases).toContain('乙');
    expect(out.find((c) => c.code === 'SEMI-01')?.retired).toBe(true);
    expect(out.find((c) => c.name === '丙')?.code).toBe('SEMI-03');
  });
});

describe('依代碼自動組名單', () => {
  const stocks = [
    { symbol: 'A', industry: 'x', cap: 100, code: 'C1' }, { symbol: 'B', industry: 'x', cap: 300, code: 'C1' },
    { symbol: 'C', industry: 'x', cap: null, code: 'C1' }, { symbol: 'D', industry: 'y', cap: 999, code: 'C2' },
  ];
  it('同代碼、市值降冪、無市值排後', () => expect(composePeerSymbols('C1', stocks, null, 12)).toEqual(['B', 'A', 'C']));
  it('人工排除優先於自動與人工加入', () => expect(composePeerSymbols('C1', stocks, { include: ['A', 'D'], exclude: ['A', 'B'] }, 12)).toEqual(['D', 'C']));
  it('上限 n 但人工加入全保留', () => expect(composePeerSymbols('C1', stocks, { include: ['D'], exclude: [] }, 2)).toEqual(['D', 'B']));
});

describe('名單檔與查找', () => {
  it('每組非自訂名單都有有效代碼，代碼不重複', () => {
    const std = PEER_GROUPS.filter((g) => !g.custom);
    for (const g of std) expect(INDUSTRY_CODES.some((c) => c.code === g.code)).toBe(true);
    expect(new Set(std.map((g) => g.code)).size).toBe(std.length);
  });
  it('舊人工確認成員全部保留', () => {
    expect(PEER_GROUPS.filter((g) => g.curation === 'manual').length).toBeGreaterThanOrEqual(106);
    for (const g of PEER_GROUPS) for (const s of g.include ?? []) if (!(g.exclude ?? []).includes(s)) expect(g.symbols).toContain(s);
  });
  it('3231 仍對應 ODM／伺服器自訂組', () => expect(findPeerGroup('3231', '晶圓代工')?.label).toBe('ODM／伺服器'));
  it('全形寫法經代碼對到同組', () => expect(findPeerGroup('9997', 'PCB／CCL')?.code).toBe(industryCodeOf('PCB/CCL')));
  it('無對應顯示資料不足', () => expect(buildPeerReference('9998', 'pe', 10, [], findPeerGroup('9998', '不存在產業')).status).toBe('insufficient'));
});
