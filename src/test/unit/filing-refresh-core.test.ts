import { describe, expect, it } from 'vitest';
import { taipeiDate, expiredEstimate, financialCacheValid, completeFinancialPeriods } from '../../../supabase/functions/_shared/filingRefreshCore';
import { nextQuarterBasis } from '../../../supabase/functions/_shared/monthRevenue';

describe('財報期限日界線與完整版本', () => {
  it.each([
    ['2025-12-31', '2026-05-15', '2026-05-16'],
    ['2026-03-31', '2026-08-14', '2026-08-15'],
    ['2026-06-30', '2026-11-14', '2026-11-15'],
    ['2026-09-30', '2027-03-31', '2027-04-01'],
  ])('最新季 %s：期限 %s 當天可用、%s 停用', (latest, deadline, next) => {
    expect(expiredEstimate(latest, deadline)).toBeNull();
    expect(expiredEstimate(latest, next)).toMatchObject({ stale: true, deadline, asOf: next });
  });
  it('台北星期日零時停用，不等星期一收盤', () => {
    expect(taipeiDate(new Date('2026-11-14T15:59:59Z'))).toBe('2026-11-14');
    expect(taipeiDate(new Date('2026-11-14T16:00:00Z'))).toBe('2026-11-15');
    expect(expiredEstimate('2026-06-30', taipeiDate(new Date('2026-11-14T16:00:00Z')))?.stale).toBe(true);
  });
  it('一小時或台北跨日立即使六小時舊快取失效', () => {
    const at = Date.parse('2026-11-14T15:59:00Z');
    expect(financialCacheValid(at, at + 59000)).toBe(true);
    expect(financialCacheValid(at, at + 60000)).toBe(false);
    expect(financialCacheValid(at, at + 3600000)).toBe(false);
    expect(financialCacheValid(at, at - 1)).toBe(false);
  });
  it('月營收未齊也必須在期限過後回資料不足', () => {
    const quarters = ['2025-09-30','2025-12-31','2026-03-31','2026-06-30'].map((period) => ({ period, revenue: 100, reportedEps: 1 }));
    expect(nextQuarterBasis({ quarters, eps: 4, reportedEpsSum: 4, psShares: 10 }, [], '2026-11-15')).toMatchObject({ stale: true, deadline: '2026-11-14' });
  });
  it('提前公布同季完整才前移，部分損益／資產負債不提交', () => {
    const r = (date: string, type: string, value = 0) => ({ date, type, value });
    const fs = [r('2026-06-30','EPS',-1), r('2026-06-30','Revenue'), r('2026-09-30','EPS',2),r('2026-09-30','Revenue',300)];
    const bs = [r('2026-06-30','OrdinaryShare',100),r('2026-06-30','Equity',50),r('2026-09-30','OrdinaryShare',100)];
    expect(completeFinancialPeriods(fs,bs)).toEqual(['2026-06-30']);
    expect(completeFinancialPeriods(fs,[...bs,r('2026-09-30','EquityAttributableToOwnersOfParent',200)])).toEqual(['2026-06-30','2026-09-30']);
  });
});
describe('完整季資料不能包含空值或相互矛盾數字', () => {
  const r = (type: string, value: number) => ({ date: '2026-09-30', type, value });
  const fs = [r('EPS', 2),r('Revenue',300)];
  const bs = [r('OrdinaryShare',100),r('Equity',500)];
  it('null、空白 EPS 不當零值', () => {
    for (const value of [null,'']) expect(completeFinancialPeriods([r('EPS',value as unknown as number),r('Revenue',300)],bs)).toEqual([]);
  });
  it('重複且矛盾 EPS、Revenue、OrdinaryShare、Equity 各自阻擋', () => {
    for (const type of ['EPS','Revenue']) expect(completeFinancialPeriods([...fs,r(type,999)],bs)).toEqual([]);
    for (const type of ['OrdinaryShare','Equity']) expect(completeFinancialPeriods(fs,[...bs,r(type,999)])).toEqual([]);
  });
});
