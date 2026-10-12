import { describe, it, expect } from 'vitest';
import { valuationHeadlineText } from '@/checkup/lib/valuationScenario';

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
