/**
 * 市場族群（散熱三雄…）純函式契約：
 *   - 白名單外一律丟棄
 *   - 去重、上限 3
 *   - 非個股（ETF/ETN/權證）不得帶族群（由分類端把關，這裡鎖 isNonEquity 判定）
 *   - 前後端字典必須 byte-equal
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  MARKET_GROUPS,
  MAX_MARKET_GROUPS,
  isValidMarketGroup,
  sanitizeMarketGroups,
  isNonEquity,
} from '@/checkup/lib/industryTaxonomy';
import { getMultiMeta, setAutoIndustryMap, clearAutoIndustryMap } from '@/checkup/lib/stockMetaMulti.js';
import { aggregateBySector, holdingsInSector } from '@/checkup/lib/holdingUtils.js';

afterEach(() => clearAutoIndustryMap());

describe('字典', () => {
  it('前台與 Deno 端字典完全一致', () => {
    const a = readFileSync('src/checkup/data/industryTaxonomy.json', 'utf8');
    const b = readFileSync('supabase/functions/_shared/industryTaxonomy.json', 'utf8');
    expect(a).toBe(b);
  });

  it('市場族群白名單非空且無重複', () => {
    expect(MARKET_GROUPS.length).toBeGreaterThan(20);
    expect(new Set(MARKET_GROUPS).size).toBe(MARKET_GROUPS.length);
    expect(MARKET_GROUPS).toContain('散熱三雄');
  });
});

describe('sanitizeMarketGroups', () => {
  it('丟棄白名單外的自創族群', () => {
    expect(sanitizeMarketGroups(['散熱三雄', '宇宙無敵概念股'])).toEqual(['散熱三雄']);
  });
  it('去重並限制上限', () => {
    const many = MARKET_GROUPS.slice(0, MAX_MARKET_GROUPS + 2);
    expect(sanitizeMarketGroups([...many, many[0]]).length).toBe(MAX_MARKET_GROUPS);
  });
  it('非陣列或空值回空陣列', () => {
    expect(sanitizeMarketGroups(null)).toEqual([]);
    expect(sanitizeMarketGroups('散熱三雄')).toEqual([]);
  });
  it('isValidMarketGroup 只認字典字串', () => {
    expect(isValidMarketGroup('CoWoS概念股')).toBe(true);
    expect(isValidMarketGroup('cowos概念股')).toBe(false);
  });
});

describe('非個股', () => {
  it('ETF 與權證判定為非個股', () => {
    expect(isNonEquity({ symbol: '0050', name: '元大台灣50' })).toBe(true);
    expect(isNonEquity({ symbol: '00878', name: '國泰永續高股息' })).toBe(true);
    expect(isNonEquity({ symbol: '3017', name: '奇鋐' })).toBe(false);
  });
});

describe('取值層與彙總', () => {
  const holdings = [
    { code: '3017', price: 1000, qty: 1000 },
    { code: '3324', price: 500, qty: 1000 },
  ];

  it('getMultiMeta 帶出分類表的市場族群', () => {
    setAutoIndustryMap({
      '3017': { industries: ['液冷散熱'], revenueMix: null, themes: [], marketGroups: ['散熱三雄'] },
    });
    const m = getMultiMeta('3017', {});
    expect(m.marketGroups).toEqual(['散熱三雄']);
    expect(m.primaryIndustry).toBe('液冷散熱');
  });

  it('沒有分類表時 marketGroups 為空陣列', () => {
    expect(getMultiMeta('9999', {}).marketGroups).toEqual([]);
  });

  it('aggregateBySector 依族群計數，且不影響產業佔比', () => {
    setAutoIndustryMap({
      '3017': { industries: ['液冷散熱'], revenueMix: null, themes: [], marketGroups: ['散熱三雄'] },
      '3324': { industries: ['散熱模組'], revenueMix: null, themes: [], marketGroups: ['散熱三雄'] },
    });
    const agg = aggregateBySector(holdings, {}, {});
    expect(agg.marketGroupByCount).toEqual([{ key: '散熱三雄', count: 2 }]);
    const total = agg.industryByValue.reduce((s: number, x: any) => s + x.pct, 0);
    expect(Math.round(total)).toBe(100);
  });

  it('holdingsInSector 支援 marketGroup 選取', () => {
    setAutoIndustryMap({
      '3017': { industries: ['液冷散熱'], revenueMix: null, themes: [], marketGroups: ['散熱三雄'] },
      '3324': { industries: ['散熱模組'], revenueMix: null, themes: [], marketGroups: [] },
    });
    const rows = holdingsInSector(holdings, {}, {}, { kind: 'marketGroup', key: '散熱三雄' });
    expect(rows.map((r: any) => r.code)).toEqual(['3017']);
    expect(rows[0].weight).toBe(1);
  });
});
