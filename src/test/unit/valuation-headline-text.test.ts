import { describe, it, expect } from 'vitest';
import { valuationHeadlineText, multipleConfidenceText } from '@/checkup/lib/valuationScenario';

const row = (key: 'pe' | 'pb' | 'ps', basisOk: boolean) => ({ key, basisOk } as any);

describe('抽屜估值判讀標題', () => {
  it('未登入不得顯示「財報分母不足」', () => {
    expect(valuationHeadlineText({ basisCount: 0, blocker: 'auth', rows: [] }, false)).toBe('登入後查看財報估值');
  });
  it('服務失敗另行陳述', () => {
    expect(valuationHeadlineText({ basisCount: 0, blocker: 'service', rows: [] }, false)).toBe('財報資料暫時取不到，稍後重試');
  });
  it('三尺分母皆不合格才顯示分母不足', () => {
    expect(valuationHeadlineText({ basisCount: 0, rows: [] }, false)).toBe('財報分母不足，無法判讀現價要求');
  });
  it('部分尺可用時列出可用尺', () => {
    expect(valuationHeadlineText({ basisCount: 2, rows: [row('pe', false), row('pb', true), row('ps', true)] }, true))
      .toBe('已核實 2 把尺（PB／PS），尚不能判定合理價');
  });
});

describe('標題與站牌一致', () => {
  const full = { basisCount: 3, rows: [row('pe', true), row('pb', true), row('ps', true)] };
  it('站牌同業可用時，標題不得出現「同業不足」並寫出家數', () => {
    const t = valuationHeadlineText(full, false, { ruler: 'ps', position: '介於下車安全帶與高壓站', peer: { status: 'ready', n: 4, group: 'ASIC設計服務' } });
    expect(t).not.toContain('不足');
    expect(t).toBe('現價介於下車安全帶與高壓站（PS 近一年）・同業 4 家可比');
  });
  it('無同業時不再寫出不足原因', () => {
    const t = valuationHeadlineText(full, false, { ruler: 'ps', position: '低於上車站', peer: { status: 'insufficient', reason: '同業不足 3 家（ASIC設計服務 可用 2 家）' } });
    expect(t).toBe('現價低於上車站（PS 近一年）・僅歷史倍數定位');
    expect(t).not.toContain('2 家');
    expect(t).not.toContain('不足');
  });
  it('有站牌但分母 0 仍顯示分母不足', () => {
    expect(valuationHeadlineText({ basisCount: 0, rows: [] }, false, { ruler: 'pe', position: '低於上車站', peer: { status: 'ready', n: 3, group: 'x' } })).toBe('財報分母不足，無法判讀現價要求');
  });
  it('未登入不受站牌影響', () => {
    expect(valuationHeadlineText({ basisCount: 0, blocker: 'auth', rows: [] }, false, { ruler: 'pe', position: '低於上車站', peer: { status: 'ready', n: 3, group: 'x' } })).toBe('登入後查看財報估值');
  });
  it('站牌同業可用時倍數信心為「有同業證據」', () => {
    const rows = [{ key: 'ps', basisOk: true, confidence: 'low' }] as any;
    expect(multipleConfidenceText({ rows }, { ruler: 'ps', position: null, peer: { status: 'ready', n: 3, group: 'x' } })).toBe('有同業證據');
    expect(multipleConfidenceText({ rows }, { ruler: 'ps', position: null, peer: { status: 'insufficient', reason: 'r' } })).toBe('低（僅歷史情境參考）');
  });
});
