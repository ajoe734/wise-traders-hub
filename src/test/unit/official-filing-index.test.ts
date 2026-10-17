import { describe,it,expect } from 'vitest';
import { FILING_FEEDS, FILING_SECTORS, parseFilingRows, collectFilingSignals } from '../../../supabase/functions/_shared/officialFilingIndex';
import { committedFiling } from '../../../supabase/functions/_shared/filingRefreshCore';

describe('官方全產業財報索引與版本提交', () => {
  it('上市／上櫃所有六種格式，損益與資產負債各一來源', () => {
    expect(FILING_FEEDS).toHaveLength(24);
    for (const market of ['TWSE','TPEx']) for (const sector of FILING_SECTORS) {
      expect(FILING_FEEDS.filter((f) => f.market===market && f.sector===sector).map((f) => f.statement)).toEqual(['06','07']);
    }
  });
  it.each(['ci','basi','ins','bd','fh','mim'])('%s 中文及英文識別格式一致、輸出日不當公布日', () => {
    expect(parseFilingRows([{ 公司代號:'2801', 年度:'115', 季別:'3', 出表日期:'1151017' }])[0]?.period).toBe('2026-09-30');
    expect(parseFilingRows([{ SecuritiesCompanyCode:'2801', Year:'115', Season:'3', Date:'1151017' }])[0]?.period).toBe('2026-09-30');
  });
  it('空白佔位合法空源；錯誤結構／季別必須失敗而非當無新財報', () => {
    expect(parseFilingRows([{ 公司代號:'', 年度:'', 季別:'' }])).toEqual([]);
    expect(() => parseFilingRows({ error:'offline' })).toThrow();
    expect(() => parseFilingRows([{ 公司代號:'2801', 年度:'115', 季別:'5' }])).toThrow();
  });
  it('混合期別取同季雙表最新；每日輸出日變化不觸發更新、內容修訂會觸發', async () => {
    const row = (q: number, date: string, eps=2) => ({ 公司代號:'1234', 年度:'115', 季別:String(q), 出表日期:date, EPS:eps });
    const first = await collectFilingSignals([{statement:'06',rows:[row(2,'1151017'),row(3,'1151017')]},{statement:'07',rows:[row(2,'1151017')]}]);
    expect(first[0]?.period).toBe('2026-06-30');
    const second = await collectFilingSignals([{statement:'06',rows:[row(2,'1151018')]},{statement:'07',rows:[row(2,'1151018')]}]);
    expect(first[0]?.signature).toBe(second[0]?.signature);
    const revised = await collectFilingSignals([{statement:'06',rows:[row(2,'1151018',3)]},{statement:'07',rows:[row(2,'1151018')]}]);
    expect(revised[0]?.signature).not.toBe(second[0]?.signature);
  });
  it('損益到但資產負債未到、未到官方新季不可提交；完整新季才提交', () => {
    const fs = [{date:'2026-09-30', type:'EPS',value:3},{date:'2026-09-30',type:'Revenue',value:300}];
    const bs = [{date:'2026-09-30',type:'OrdinaryShare',value:100},{date:'2026-09-30',type:'Equity',value:500}];
    expect(committedFiling(fs,[],'2026-09-30')).toBeNull();
    expect(committedFiling(fs,bs,'2026-12-31')).toBeNull();
    expect(committedFiling(fs,bs,'2026-09-30')?.latest).toBe('2026-09-30');
  });
});