import { describe, it, expect } from 'vitest';
import { computePayroll, taipeiMonth, payDate, type PayoutLock } from '@/lib/expertPayroll';

const sp = (id: string, amt: number, e = 'E') => ({ transaction_id: id, expert_id: e, expert_amount: amt, net: amt * 1.25, platform_amount: amt * 0.25 });
const tx = (id: string, paid_at: string, status = 'paid', sub = 's1') => ({ id, status, paid_at, created_at: paid_at, subscription_id: sub });
const lock = (m: string, amount: number, paid_at = '2026-10-05T02:00:00Z'): PayoutLock => ({
  expert_id: 'E', period_month: m, status: 'paid', paid_at, earnings: amount, clawback: 0, carry_in: 0,
  amount, net: 0, platform_amount: 0, tx_count: 1, student_count: 1,
});

describe('expertPayroll', () => {
  it('台北時區邊界：UTC 9/30 16:30 = 台北 10/01', () => {
    expect(taipeiMonth('2026-09-30T15:59:00Z')).toBe('2026-09');
    expect(taipeiMonth('2026-09-30T16:00:00Z')).toBe('2026-10');
    expect(payDate('2026-12')).toBe('2027/01/05');
  });

  it('年繳整筆算付款月份，學員數依訂閱去重', () => {
    const r = computePayroll([sp('a', 7000), sp('b', 600)], [tx('a', '2026-09-10T00:00:00Z'), tx('b', '2026-09-11T00:00:00Z', 'paid', 's2')], {}, { s1: 'u1', s2: 'u1' }, [], '2026-09');
    expect(r.E['2026-09'].amount).toBe(7600);
    expect(r.E['2026-09'].student_count).toBe(1);
    expect(r.E['2026-09'].tx_count).toBe(2);
  });

  it('未發放月份退款 → 直接不計', () => {
    const r = computePayroll([sp('a', 600)], [tx('a', '2026-09-10T00:00:00Z', 'refunded')], { a: '2026-09-20T00:00:00Z' }, {}, [], '2026-09');
    expect(r.E['2026-09'].amount).toBe(0);
  });

  it('已發放後退款 → 下月扣回，原月快照不變', () => {
    const r = computePayroll(
      [sp('a', 600), sp('b', 1000)],
      [tx('a', '2026-09-10T00:00:00Z', 'refunded'), tx('b', '2026-10-10T00:00:00Z')],
      { a: '2026-10-08T00:00:00Z' }, {}, [lock('2026-09', 600)], '2026-10',
    );
    expect(r.E['2026-09'].amount).toBe(600);
    expect(r.E['2026-09'].locked).toBe(true);
    expect(r.E['2026-10'].clawback).toBe(600);
    expect(r.E['2026-10'].amount).toBe(400);
  });

  it('扣回後負數延續到再下個月', () => {
    const r = computePayroll(
      [sp('a', 600), sp('c', 1000)],
      [tx('a', '2026-09-10T00:00:00Z', 'refunded'), tx('c', '2026-11-10T00:00:00Z')],
      { a: '2026-10-08T00:00:00Z' }, {}, [lock('2026-09', 600)], '2026-11',
    );
    expect(r.E['2026-10'].amount).toBe(-600);
    expect(r.E['2026-11'].carry_in).toBe(-600);
    expect(r.E['2026-11'].amount).toBe(400);
  });

  it('取消標記（unmarked）視為未鎖', () => {
    const l = { ...lock('2026-09', 999), status: 'unmarked' };
    const r = computePayroll([sp('a', 600)], [tx('a', '2026-09-10T00:00:00Z')], {}, {}, [l], '2026-09');
    expect(r.E['2026-09'].locked).toBe(false);
    expect(r.E['2026-09'].amount).toBe(600);
  });
});

describe('expertPayroll 金流商負額退款', () => {
  const t2 = (id: string, paid_at: string, status: string, amount: number, sub = 's1') => ({ id, status, paid_at, created_at: paid_at, subscription_id: sub, amount });
  it('已發放後部分退款 → 依原分潤比例於下月扣回，標明扣回月', () => {
    const r = computePayroll(
      [sp('a', 3600)],
      [t2('a', '2026-09-10T00:00:00Z', 'paid', 7990), t2('rf', '2026-10-08T00:00:00Z', 'refunded', -3995)],
      {}, {}, [lock('2026-09', 3600)], '2026-10',
    );
    expect(r.E['2026-09'].amount).toBe(3600);
    expect(r.E['2026-10'].clawback).toBe(1800);
    expect(r.E['2026-10'].amount).toBe(-1800);
    expect(r.E['2026-10'].clawbackItems[0]).toMatchObject({ fromMonth: '2026-09', refundMonth: '2026-10', amount: 1800 });
  });
  it('未發放月份的負額退款 → 直接從原月份扣除', () => {
    const r = computePayroll(
      [sp('a', 3600)],
      [t2('a', '2026-09-10T00:00:00Z', 'paid', 7990), t2('rf', '2026-09-20T00:00:00Z', 'refunded', -7990)],
      {}, {}, [], '2026-09',
    );
    expect(r.E['2026-09'].amount).toBe(0);
    expect(r.E['2026-09'].clawback).toBe(0);
  });
  it('已鎖月份使用快照中的扣回明細', () => {
    const l = { ...lock('2026-10', -1800), clawback: 1800, clawback_items: [{ transaction_id: 'rf', amount: 1800, fromMonth: '2026-09', refundMonth: '2026-10' }] };
    const r = computePayroll([], [], {}, {}, [l], '2026-10');
    expect(r.E['2026-10'].clawbackItems).toHaveLength(1);
  });
});
