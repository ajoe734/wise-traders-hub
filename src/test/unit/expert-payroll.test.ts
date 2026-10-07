import { describe, it, expect } from 'vitest';
import { computePayroll, taipeiMonth, payDate, addMonthsTaipei, recognitionSchedule, type PayoutLock } from '@/lib/expertPayroll';

const sp = (id: string, amt: number, e = 'E') => ({ transaction_id: id, expert_id: e, expert_amount: amt, net: amt * 2, platform_amount: amt });
const tx = (id: string, paid_at: string, status = 'paid', sub = 's1', amount = 799) => ({ id, status, paid_at, created_at: paid_at, subscription_id: sub, amount });
const lock = (m: string, amount: number): PayoutLock => ({
  expert_id: 'E', period_month: m, status: 'paid', paid_at: '2026-11-05T02:00:00Z', earnings: amount, clawback: 0, carry_in: 0,
  amount, net: 0, platform_amount: 0, tx_count: 1, student_count: 1,
});

describe('expertPayroll 服務期滿月計價', () => {
  it('台北時區與月底夾住', () => {
    expect(taipeiMonth('2026-09-30T16:00:00Z')).toBe('2026-10');
    expect(payDate('2026-12')).toBe('2027/01/05');
    expect(addMonthsTaipei('2026-01-31T04:00:00Z', 1).slice(0, 10)).toBe('2026-02-28');
  });

  it('月繳：9/20 付款算在 10 月；8/25 付款算在 9 月', () => {
    const r = computePayroll([sp('a', 360), sp('b', 360)],
      [tx('a', '2026-09-20T00:00:00Z'), tx('b', '2026-08-25T00:00:00Z', 'paid', 's2')], {}, { s1: 'u1', s2: 'u2' }, [], '2026-10');
    expect(r.E['2026-09'].amount).toBe(360);
    expect(r.E['2026-10'].amount).toBe(360);
    expect(r.E['2026-10'].items[0].end_at.slice(0, 10)).toBe('2026-10-20');
  });

  it('年繳拆 12 期，尾差放最後一期', () => {
    const items = recognitionSchedule('a', 's1', '2026-03-15T02:00:00Z', 1000, 'yearly');
    expect(items).toHaveLength(12);
    expect(items[0].amount).toBe(83.33);
    expect(items[11].amount).toBe(83.37);
    expect(taipeiMonth(items[0].end_at)).toBe('2026-04');
    expect(taipeiMonth(items[11].end_at)).toBe('2027-03');
    const r = computePayroll([sp('a', 1200)], [tx('a', '2026-03-15T02:00:00Z')], {}, {}, [], '2027-03', { s1: 'yearly' });
    expect(r.E['2026-03']).toBeUndefined();
    expect(r.E['2026-04'].amount).toBe(100);
    expect(r.E['2027-03'].amount).toBe(100);
  });

  it('月繳期滿前退款：整筆不計', () => {
    const r = computePayroll([sp('a', 360)], [tx('a', '2026-09-20T00:00:00Z', 'refunded')], { a: '2026-10-01T00:00:00Z' }, {}, [], '2026-10');
    expect(r.E?.['2026-10']?.amount ?? 0).toBe(0);
  });

  it('年繳中途退款：只算已滿期月份', () => {
    const r = computePayroll([sp('a', 1200)], [tx('a', '2026-01-10T02:00:00Z', 'refunded')], { a: '2026-04-01T00:00:00Z' }, {}, [], '2026-12', { s1: 'yearly' });
    const total = Object.values(r.E).reduce((s, x) => s + x.earnings, 0);
    expect(total).toBe(200); // 2/10、3/10 滿期
    expect(r.E['2026-04'].amount).toBe(0);
  });

  it('金流商部分退款（年繳退剩餘）：未滿期期數依比例縮減', () => {
    const r = computePayroll([sp('a', 1200)],
      [tx('a', '2026-01-10T02:00:00Z', 'paid', 's1', 12000), { id: 'r', status: 'refunded', paid_at: '2026-04-01T00:00:00Z', created_at: '2026-04-01T00:00:00Z', subscription_id: 's1', amount: -9000 }],
      {}, {}, [], '2026-12', { s1: 'yearly' });
    const total = Object.values(r.E).reduce((s, x) => s + x.earnings, 0);
    expect(total).toBeCloseTo(300, 0); // 已滿期 200 + 剩餘 10 期 ×(1-9000/10000)
  });

  it('週期不明視為月繳並標記', () => {
    const items = recognitionSchedule('a', null, '2026-09-01T00:00:00Z', 100, undefined);
    expect(items[0].cycleUnknown).toBe(true);
  });

  it('已發放月份使用快照，數字不變', () => {
    const r = computePayroll([sp('a', 360)], [tx('a', '2026-09-20T00:00:00Z')], {}, {}, [lock('2026-10', 999)], '2026-10');
    expect(r.E['2026-10'].amount).toBe(999);
    expect(r.E['2026-10'].locked).toBe(true);
  });

  it('不看手動延長的到期日：只依付款日推算', () => {
    const r = computePayroll([sp('a', 360)], [tx('a', '2026-09-14T00:00:00Z')], {}, {}, [], '2026-11');
    expect(r.E['2026-10'].amount).toBe(360);
    expect(r.E['2026-11'].amount).toBe(0);
  });
});
