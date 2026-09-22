/**
 * autoMap 層（全市場細分產業分類表）在 getMultiMeta 的優先序契約。
 *
 * 鐵則：手動修正（DB override）> overlay JSON > seed base > autoMap > TWSE 官方大類。
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  getMultiMeta,
  setAutoIndustryMap,
  clearAutoIndustryMap,
  UNCLASSIFIED,
} from '@/checkup/lib/stockMetaMulti.js';

afterEach(() => clearAutoIndustryMap());

const EMPTY_META: Record<string, any> = {};

describe('autoMap 層', () => {
  it('沒有其他來源時，採用分類表的細分產業與題材', () => {
    setAutoIndustryMap({
      '2454': { industries: ['IC設計'], revenueMix: null, themes: ['AI伺服器'] },
    });
    const m = getMultiMeta('2454', EMPTY_META);
    expect(m.industries).toEqual(['IC設計']);
    expect(m.themes).toContain('AI伺服器');
  });

  it('分類表優先於 TWSE 官方大類（不再只有「半導體業」這種大類）', () => {
    setAutoIndustryMap({
      '2330': { industries: ['晶圓代工'], revenueMix: null, themes: [] },
    });
    const m = getMultiMeta('2330', EMPTY_META);
    expect(m.industries[0]).toBe('晶圓代工');
    expect(m.industries).not.toContain('半導體業');
  });

  it('分類表的細分產業壓過舊的手工 overlay 大類（3443 創意＝ASIC設計服務）', () => {
    setAutoIndustryMap({
      '3443': { industries: ['ASIC設計服務', '矽智財IP'], revenueMix: null, themes: ['AI伺服器'] },
    });
    const m = getMultiMeta('3443', EMPTY_META);
    expect(m.industries[0]).toBe('ASIC設計服務');
    expect(m.industries).not.toContain('IC設計');
  });

  it('手動修正（override）永遠壓過分類表', () => {
    setAutoIndustryMap({
      '3443': { industries: ['ASIC設計服務'], revenueMix: null, themes: [] },
    });
    const m = getMultiMeta('3443', EMPTY_META, { industries: ['自訂族群'] });
    expect(m.industries).toEqual(['自訂族群']);
  });

  it('seed base 只在分類表沒有這檔時才生效', () => {
    setAutoIndustryMap({});
    const m = getMultiMeta('9999', { '9999': { industries: ['seed族群'] } });
    expect(m.industries).toEqual(['seed族群']);
  });


  it('分類表的營收組成只在該檔真的採用分類表時生效', () => {
    setAutoIndustryMap({
      '8888': {
        industries: ['散熱模組', '機殼結構件'],
        revenueMix: [
          { industry: '散熱模組', pct: 70 },
          { industry: '機殼結構件', pct: 30 },
        ],
        themes: [],
      },
    });
    const m = getMultiMeta('8888', EMPTY_META);
    expect(m.revenueMix?.[0]).toMatchObject({ industry: '散熱模組' });
    expect(m.industries[0]).toBe('散熱模組');
  });

  it('分類表沒有這檔時維持原本的未分類行為', () => {
    setAutoIndustryMap({ '2454': { industries: ['IC設計'], revenueMix: null, themes: [] } });
    const m = getMultiMeta('000000', EMPTY_META);
    expect(m.industries).toEqual([UNCLASSIFIED]);
  });
});
