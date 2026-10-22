/**
 * 分類採用門檻：AI 分類必須有依據才上線。
 * 規則：人工確認 → 上線；否則需信心 ≥ 0.9 且附依據文字。
 */
import { describe, it, expect } from 'vitest';
import {
  isAdoptedClassification,
  chainTierOf,
  isValidIndustry,
  ADOPT_MIN_CONFIDENCE,
} from '@/checkup/lib/industryTaxonomy';
import { normalizeRow } from '@/checkup/hooks/useStockIndustryMap';
import { parseMainBusiness } from '../../../supabase/functions/_shared/mopsBusiness';
import { findPeerGroup } from '@/checkup/lib/valuationStations';

describe('分類採用門檻', () => {
  it('門檻是 0.9', () => expect(ADOPT_MIN_CONFIDENCE).toBe(0.9));
  it('人工確認一律上線', () => expect(isAdoptedClassification({ reviewed: true, confidence: 0.2, evidence: null })).toBe(true));
  it('信心 0.95 且有依據 → 上線', () =>
    expect(isAdoptedClassification({ reviewed: false, confidence: 0.95, evidence: '主要經營業務：電子級玻璃纖維' })).toBe(true));
  it('信心 0.95 但沒有依據 → 不上線', () =>
    expect(isAdoptedClassification({ reviewed: false, confidence: 0.95, evidence: '' })).toBe(false));
  it('有依據但信心 0.85 → 不上線', () =>
    expect(isAdoptedClassification({ reviewed: false, confidence: 0.85, evidence: '主要經營業務：電子級玻璃纖維' })).toBe(false));
  it('舊的無依據 AI 猜測（富喬 PCB/CCL 0.85）前台不載入', () =>
    expect(normalizeRow({ industries: ['PCB/CCL', '玻璃陶瓷'], confidence: 0.85, reviewed: false, evidence: null })).toBeNull());
  it('有依據的高信心分類前台載入', () =>
    expect(normalizeRow({ industries: ['玻纖紗/玻纖布'], confidence: 0.95, reviewed: false, evidence: '主要經營業務：電子級玻璃纖維' })?.industries).toEqual(['玻纖紗/玻纖布']));
});

describe('PCB 產業鏈', () => {
  it('上中下游分開成不同細分產業', () => {
    for (const n of ['玻纖紗/玻纖布', '銅箔', 'PCB化學品及耗材', 'CCL銅箔基板', 'PCB板廠']) expect(isValidIndustry(n)).toBe(true);
    expect(isValidIndustry('PCB/CCL')).toBe(false);
    expect(chainTierOf('玻纖紗/玻纖布')).toBe('上游');
    expect(chainTierOf('CCL銅箔基板')).toBe('中游');
    expect(chainTierOf('PCB板廠')).toBe('下游');
  });
  it('富喬同業是玻纖廠，不是 CCL 廠', () => {
    const g = findPeerGroup('1815', '玻纖紗/玻纖布');
    expect(g?.symbols).toEqual(expect.arrayContaining(['5340', '5475']));
    expect(g?.symbols).not.toContain('6274');
    expect(g?.symbols).not.toContain('2383');
  });
  it('PCB 板廠同業不含 CCL、玻纖、銅箔廠', () => {
    const g = findPeerGroup('3044', 'PCB板廠');
    for (const s of ['6274', '6213', '2383', '1815', '8358']) expect(g?.symbols).not.toContain(s);
  });
});

describe('主要經營業務解析', () => {
  it('取出並去掉重複品項', () => {
    const html = '<tr><th>主要經營業務</th><td>電子級玻璃纖維 <br>電子級玻璃纖維 <br>電子級玻璃纖維</td></tr>';
    expect(parseMainBusiness(html)).toBe('電子級玻璃纖維');
  });
  it('沒有欄位回 null', () => expect(parseMainBusiness('<html>無資料</html>')).toBeNull());
});
