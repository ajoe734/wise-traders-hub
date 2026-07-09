/**
 * Unit tests for src/checkup/lib/stockMetaMulti.js — getMultiMeta()
 *
 * 焦點：當 holding_meta_overrides 明確提供 industries 時，
 * 必須永遠優先於任何 revenueMix（不論 revenueMix 來自 override / overlay / base），
 * 且 primaryIndustry 必等於 override.industries[0]。
 *
 * 這是 HoldingMetaReportModal reopen bug 的迴歸鎖：
 * modal 儲存後會把 base 的 revenue_mix 一併寫回 override row，
 * 若這裡把 revenueMix 順序覆蓋 industries，使用者輸入就會消失。
 */
import { describe, it, expect } from 'vitest';
import { getMultiMeta, UNCLASSIFIED } from '@/checkup/lib/stockMetaMulti';

const STOCK_META: Record<string, any> = {
  '2330': {
    industries: ['半導體'],
    industry: '半導體',
    revenueMix: [
      { industry: '晶圓代工', pct: 90 },
      { industry: '其他', pct: 10 },
    ],
    themes: ['AI'],
    strategy: '長期持有',
  },
  '2317': {
    industry: '電子零組件',
  },
};

describe('getMultiMeta — override.industries 絕對優先', () => {
  it('override.industries 存在時，即使有 override.revenue_mix 也不能被 mix 覆蓋順序', () => {
    const override = {
      industries: ['自訂A', '自訂B'],
      revenue_mix: [
        { industry: '晶圓代工', pct: 90 },
        { industry: '其他', pct: 10 },
      ],
    };
    const meta = getMultiMeta('2330', STOCK_META, override);
    expect(meta.industries).toEqual(['自訂A', '自訂B']);
    expect(meta.primaryIndustry).toBe('自訂A');
  });

  it('override.industries 存在時，也不會被 base.revenueMix 順序覆蓋', () => {
    const override = { industries: ['使用者輸入'] };
    const meta = getMultiMeta('2330', STOCK_META, override);
    expect(meta.industries).toEqual(['使用者輸入']);
    expect(meta.primaryIndustry).toBe('使用者輸入');
  });

  it('override.industries 存在時，revenueMix 本身仍然回傳（供 UI 顯示），但 industries 不被覆蓋', () => {
    const override = {
      industries: ['自訂A'],
      revenue_mix: [{ industry: 'X', pct: 100 }],
    };
    const meta = getMultiMeta('2330', STOCK_META, override);
    expect(meta.revenueMix).toEqual([{ industry: 'X', pct: 100 }]);
    expect(meta.industries).toEqual(['自訂A']);
  });

  it('override.industries 為空陣列時，視同未提供，退回 revenueMix 順序', () => {
    const override = {
      industries: [],
      revenue_mix: [
        { industry: '晶圓代工', pct: 90 },
        { industry: '其他', pct: 10 },
      ],
    };
    const meta = getMultiMeta('2330', STOCK_META, override);
    expect(meta.industries).toEqual(['晶圓代工', '其他']);
  });

  it('沒有 override 時，revenueMix 決定 industries 順序（既有行為不變）', () => {
    const meta = getMultiMeta('2330', STOCK_META, undefined);
    expect(meta.industries).toEqual(['晶圓代工', '其他']);
    expect(meta.primaryIndustry).toBe('晶圓代工');
  });

  it('override.industries 會合併 themes（不覆蓋 base themes）', () => {
    const override = { industries: ['自訂A'], themes: ['機器人'] };
    const meta = getMultiMeta('2330', STOCK_META, override);
    expect(meta.themes).toEqual(expect.arrayContaining(['AI', '機器人']));
  });

  it('完全沒有任何來源時，industries 退回未分類', () => {
    const meta = getMultiMeta('9999', STOCK_META, undefined);
    expect(meta.industries).toEqual([UNCLASSIFIED]);
    expect(meta.primaryIndustry).toBe(UNCLASSIFIED);
  });
});
