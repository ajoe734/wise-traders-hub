import { describe, it, expect } from 'vitest';
import taxonomy from '@/checkup/data/industryTaxonomy.json';
import denoTaxonomy from '../../../supabase/functions/_shared/industryTaxonomy.json';
import { parseProductShares, mapProductShares } from '../../../supabase/functions/_shared/annualReportMix';
import { dominantIndustry, resolveChainClassification } from '../../../supabase/functions/_shared/chainClassification';
import { isValidIndustry } from '@/checkup/lib/industryTaxonomy';

const productMap = (taxonomy as any).productSourceMap as Record<string, string>;

// 摘自實際年報版面（富喬、潤泰材、南緯、南亞）
const FUQIAO = `    2、所營業務之營業比重：
      本 公 司 主 要 產 品 為 玻 璃 纖 維 紗 及 玻 璃 纖 維 布 ， 113 年 總 營 收 合 計 ：
      4,246,703 仟元，其營業比重如下：
      玻璃纖維紗: 47.73%
      玻璃纖維布: 52.27%
    3、公司目前之產品項目：`;
const COLUMNS = `    2.營業比重
       水泥     混凝土          石膏板
       22%     64%          14%
    3.公司目前之商品項目`;
const TABLE = `2. 營業比重：
   營業內容     營業金額(仟元)     營業比重(%)
  紡織品        3,049,115      64%
  零售/成衣      1,302,803      28%
  租賃收入         378,032       8%
  其 他            3,243       -
  合 計        4,733,193     100%
3. 公司目前現有商品：`;

describe('年報營業比重解析', () => {
  it('冒號列式：富喬玻纖紗47.73%、玻纖布52.27%', () => {
    const r = parseProductShares(FUQIAO);
    expect(r.reason).toBeNull();
    expect(r.products).toEqual([{ product: '玻璃纖維紗', pct: 47.73 }, { product: '玻璃纖維布', pct: 52.27 }]);
  });
  it('橫式：產品一列、百分比一列', () =>
    expect(parseProductShares(COLUMNS).products).toEqual([
      { product: '水泥', pct: 22 }, { product: '混凝土', pct: 64 }, { product: '石膏板', pct: 14 },
    ]));
  it('表格式：略過合計與「-」，取最後一欄百分比', () =>
    expect(parseProductShares(TABLE).products.map((p) => p.pct)).toEqual([64, 28, 8]));
  it('總和不在95–100.5 → 不採用並寫原因', () => {
    const r = parseProductShares(`營業比重\n  甲產品   40%\n  乙產品   30%\n3.公司目前之商品`);
    expect(r.reason).toBe('營業比重總和70%無法核對');
  });
  it('找不到段落 → 不採用', () => expect(parseProductShares('沒有這段').reason).toBe('年報找不到營業比重段落'));
});

describe('年報產品對照字典', () => {
  it('前後端對照表一致', () => expect((denoTaxonomy as any).productSourceMap).toEqual(productMap));
  it('對照表只指向字典內產業', () => {
    for (const v of Object.values(productMap)) expect(isValidIndustry(v)).toBe(true);
  });
  it('富喬兩項產品同屬玻纖紗/玻纖布，加總100% → 主業', () => {
    const { mix, unmapped } = mapProductShares(parseProductShares(FUQIAO).products, productMap, isValidIndustry);
    expect(unmapped).toEqual([]);
    expect(dominantIndustry({ revenueMix: mix, source: 'annual_report', isValidIndustry }).industry).toBe('玻纖紗/玻纖布');
  });
  it('名稱不完全一致的產品不猜，照列未對照', () => {
    const { unmapped } = mapProductShares([{ product: '電子級玻纖布特規品', pct: 100 }], productMap, isValidIndustry);
    expect(unmapped).toEqual([{ product: '電子級玻纖布特規品', pct: 100 }]);
  });
  it('未對照產品占比最大 → 不能成為主業，也不讓次要產品頂上', () => {
    const { mix } = mapProductShares([{ product: '玻璃纖維布', pct: 30 }, { product: '神秘產品', pct: 70 }], productMap, isValidIndustry);
    const d = dominantIndustry({ revenueMix: mix, source: 'annual_report', isValidIndustry });
    expect(d.industry).toBeNull();
    expect(d.reason).toBe('年報最大產品「神秘產品」70%未對照字典');
  });
  it('未對照產品是第二名時，仍計入領先門檻', () => {
    const { mix } = mapProductShares([{ product: '玻璃纖維布', pct: 52 }, { product: '神秘產品', pct: 48 }], productMap, isValidIndustry);
    expect(dominantIndustry({ revenueMix: mix, source: 'annual_report', isValidIndustry }).industry).toBeNull();
  });
  it('多角化公司：年報主業在平台產業內 → 自動上線', () => {
    const { mix } = mapProductShares([{ product: '玻璃纖維布', pct: 60 }, { product: '神秘產品', pct: 40 }], productMap, isValidIndustry);
    const members = [
      { chain: '印刷電路板', tier: '上游', subCode: 'L100', subItem: '玻璃纖維/玻纖布' },
      { chain: '印刷電路板', tier: '中游', subCode: 'L630', subItem: '銅箔基板' },
    ];
    const r = resolveChainClassification({ members, current: ['玻璃陶瓷'], revenueMix: mix, revenueMixSource: 'annual_report', map: (taxonomy as any).chainSourceMap, isValidIndustry });
    expect(r.status).toBe('adopted');
    expect(r.industry).toBe('玻纖紗/玻纖布');
  });
});

describe('年報主業依據', () => {
  it('占比與領先點數取到小數兩位，依據同時寫產業鏈與年報占比', () => {
    const members = [
      { chain: '印刷電路板', tier: '上游', subCode: 'L100', subItem: '玻璃纖維/玻纖布' },
      { chain: '印刷電路板', tier: '中游', subCode: 'L630', subItem: '銅箔基板' },
    ];
    const mix = [{ industry: '玻纖紗/玻纖布', pct: 47.1 }, { industry: '玻纖紗/玻纖布', pct: 47.1 }, { industry: 'CCL銅箔基板', pct: 5.8 }];
    const r = resolveChainClassification({ members, current: ['玻璃陶瓷'], revenueMix: mix, revenueMixSource: 'annual_report', map: (taxonomy as any).chainSourceMap, isValidIndustry });
    expect(r.evidence).toBe('產業價值鏈：印刷電路板 上游 玻璃纖維/玻纖布；年報營收占比94.2%，領先88.4點');
  });
});
