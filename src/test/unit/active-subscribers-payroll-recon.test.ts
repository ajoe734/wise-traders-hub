import { describe, it, expect } from 'vitest';
import { summarizeActiveSubscribers } from '@/lib/activeSubscribers';
import { computePayroll, payrollReconciliation } from '@/lib/expertPayroll';

const NOW = Date.parse('2026-11-05T02:00:00Z');
const E = 'exp1';

describe('summarizeActiveSubscribers', () => {
  const subs = [
    { id: 'y1', user_id: 'u1', expert_id: E, status: 'active', billing_cycle: 'yearly', expires_at: '2027-10-20T00:00:00Z' },
    { id: 'y2', user_id: 'u2', expert_id: E, status: 'active', billing_cycle: 'yearly', expires_at: '2027-10-21T00:00:00Z' },
    { id: 'm1', user_id: 'u3', expert_id: E, status: 'active', billing_cycle: 'monthly', expires_at: '2026-11-20T00:00:00Z' },
    { id: 'm1b', user_id: 'u3', expert_id: E, status: 'active', billing_cycle: 'monthly', expires_at: '2026-12-20T00:00:00Z' },
    { id: 'gift', user_id: 'u4', expert_id: E, status: 'active', billing_cycle: 'monthly', expires_at: null },
    { id: 'old', user_id: 'u5', expert_id: E, status: 'active', billing_cycle: 'monthly', expires_at: '2026-11-01T00:00:00Z' },
    { id: 'self', user_id: 'owner', expert_id: E, status: 'active', billing_cycle: 'monthly', expires_at: null },
    { id: 'tst', user_id: 'tester', expert_id: E, status: 'active', billing_cycle: 'monthly', expires_at: null },
  ];
  const paid = new Set(['y1', 'y2', 'm1', 'm1b', 'old', 'self', 'tst']);
  const r = summarizeActiveSubscribers(subs, paid, new Set(['tester']), { [E]: 'owner' }, NOW)[E];

  it('年繳有效用戶計入且週期小計為 2', () => expect(r.yearly).toBe(2));
  it('同一人多筆只算一人', () => expect(r.monthly).toBe(1));
  it('已過期、老師本人、測試帳號不計入', () => expect(r.paidUsers.sort()).toEqual(['u1', 'u2', 'u3']));
  it('無付款紀錄者歸未付款', () => expect(r.unpaidUsers).toEqual(['u4']));
});

describe('payrollReconciliation', () => {
  const splits = [
    { transaction_id: 'ty', expert_id: E, expert_amount: 3600, net: 7990, platform_amount: 4390 },
    { transaction_id: 'tm_oct', expert_id: E, expert_amount: 360, net: 799, platform_amount: 439 },
    { transaction_id: 'tm_sep', expert_id: E, expert_amount: 360, net: 799, platform_amount: 439 },
  ];
  const txs = [
    { id: 'ty', status: 'paid', paid_at: '2026-10-20T03:00:00Z', created_at: '2026-10-20T03:00:00Z', subscription_id: 'sy' },
    { id: 'tm_oct', status: 'paid', paid_at: '2026-10-25T03:00:00Z', created_at: '2026-10-25T03:00:00Z', subscription_id: 'sm2' },
    { id: 'tm_sep', status: 'paid', paid_at: '2026-09-20T03:00:00Z', created_at: '2026-09-20T03:00:00Z', subscription_id: 'sm1' },
  ];
  const cyc = { sy: 'yearly', sm1: 'monthly', sm2: 'monthly' };
  const row = computePayroll(splits, txs, {}, {}, [], '2026-11', cyc)[E]['2026-10'];
  const rc = payrollReconciliation(splits, txs, cyc, E, '2026-10', row.earnings);

  it('10 月年繳全部遞延、月繳 9 月轉入', () => {
    expect(rc.cashIn).toBe(3960);
    expect(rc.deferred).toBe(3960);
    expect(rc.carriedIn).toBe(360);
  });
  it('收款 − 遞延 + 轉入 − 退款 = 當月分潤', () => {
    expect(row.earnings).toBe(360);
    expect(rc.cashIn - rc.deferred + rc.carriedIn - rc.refundDropped).toBe(row.earnings);
    expect(rc.refundDropped).toBe(0);
  });
});
