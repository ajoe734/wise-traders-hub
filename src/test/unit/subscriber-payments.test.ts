import { describe, it, expect } from 'vitest';
import {
  buildPaymentIndex,
  paymentsForSpell,
  paymentsForGroup,
  startPaymentGapDays,
  startPaymentGapHint,
  type PaymentRow,
} from '@/lib/subscriberPayments';

const row = (o: Partial<PaymentRow>): PaymentRow => ({
  subscription_id: 's1',
  amount: 799,
  status: 'paid',
  paid_at: '2026-08-06T14:55:26.832Z',
  created_at: '2026-08-06T14:55:26.987Z',
  ...o,
});

describe('buildPaymentIndex', () => {
  it('只收已付款、依時間由舊到新排序', () => {
    const idx = buildPaymentIndex([
      row({ paid_at: '2026-09-06T00:00:00Z', amount: 899 }),
      row({ paid_at: '2026-08-06T00:00:00Z' }),
      row({ status: 'pending', paid_at: '2026-07-01T00:00:00Z' }),
      row({ status: 'failed', paid_at: '2026-07-02T00:00:00Z' }),
      row({ subscription_id: null }),
    ]);
    expect(idx.s1.map((r) => r.amount)).toEqual([799, 899]);
  });

  it('paid_at 缺漏時退回 created_at；兩者皆無則略過', () => {
    const idx = buildPaymentIndex([
      row({ paid_at: null }),
      row({ subscription_id: 's2', paid_at: null, created_at: null }),
    ]);
    expect(idx.s1).toHaveLength(1);
    expect(idx.s2).toBeUndefined();
  });
});

describe('paymentsForSpell / paymentsForGroup', () => {
  it('單期摘要：首次、最近、金額', () => {
    const idx = buildPaymentIndex([
      row({ paid_at: '2026-08-06T00:00:00Z', amount: 799 }),
      row({ paid_at: '2026-09-06T00:00:00Z', amount: 899 }),
    ]);
    const s = paymentsForSpell(idx, 's1');
    expect(s.count).toBe(2);
    expect(s.firstPaidAt).toBe('2026-08-06T00:00:00Z');
    expect(s.lastPaidAt).toBe('2026-09-06T00:00:00Z');
    expect(s.lastAmount).toBe(899);
    expect(s.totalAmount).toBe(1698);
  });

  it('沒有付款紀錄時回空摘要，不丟錯', () => {
    expect(paymentsForSpell({}, 'nope').count).toBe(0);
    expect(paymentsForSpell({}, null).totalAmount).toBe(0);
  });

  it('群組摘要跨多期合併並重新排序', () => {
    const idx = buildPaymentIndex([
      row({ subscription_id: 'b', paid_at: '2026-09-06T00:00:00Z', amount: 899 }),
      row({ subscription_id: 'a', paid_at: '2026-08-06T00:00:00Z', amount: 799 }),
    ]);
    const g = paymentsForGroup(idx, ['b', 'a', null, 'missing']);
    expect(g.count).toBe(2);
    expect(g.firstPaidAt).toBe('2026-08-06T00:00:00Z');
    expect(g.lastAmount).toBe(899);
    expect(g.totalAmount).toBe(1698);
  });
});

describe('startPaymentGapDays / startPaymentGapHint', () => {
  it('廖基富案例：起始日 7/27、付款日 8/06 → 落差 11 天並提示', () => {
    const gap = startPaymentGapDays('2026-07-26T16:00:00Z', '2026-08-06T14:55:26.832Z');
    expect(gap).toBe(11);
    const hint = startPaymentGapHint('2026-07-26T16:00:00Z', '2026-08-06T14:55:26.832Z');
    expect(hint?.label).toBe('起始日與付款日差 11 天');
    expect(hint?.title).toContain('起始日早於付款日');
  });

  it('同日開通不提示；缺值不提示', () => {
    expect(startPaymentGapHint('2026-08-06T02:00:00Z', '2026-08-06T14:00:00Z')).toBeNull();
    expect(startPaymentGapHint(null, '2026-08-06T14:00:00Z')).toBeNull();
    expect(startPaymentGapDays('2026-08-06T00:00:00Z', null)).toBeNull();
  });

  it('起始日晚於付款日也會被抓出來', () => {
    const hint = startPaymentGapHint('2026-08-20T00:00:00Z', '2026-08-06T00:00:00Z');
    expect(hint?.days).toBe(-14);
    expect(hint?.title).toContain('起始日晚於付款日');
  });
});
