import { describe, it, expect } from 'vitest';
import { computePayroll, payrollReconciliation, MONTHLY_FREE_LIMIT } from '@/lib/expertPayroll';

// 每筆 799：淨收 799、原比例老師 360、平台 439。
const sp = (id: string, e = 'E') => ({ transaction_id: id, expert_id: e, expert_amount: 360, net: 799, platform_amount: 439 });
const tx = (id: string, day: number, sub = `s${id}`, month = '09') => ({
  id, status: 'paid', paid_at: `2026-${month}-${String(day).padStart(2, '0')}T02:00:00Z`, created_at: '', subscription_id: sub, amount: 799,
});
const ids = (n: number, p = 't') => Array.from({ length: n }, (_, i) => `${p}${String(i).padStart(2, '0')}`);
const promo = (ex: string[] = []) => ({ limit: MONTHLY_FREE_LIMIT, excludedTx: new Set(ex) });

describe('每月薪資前 20 筆不抽成', () => {
  it('同月 22 筆：前 20 筆老師拿 799，第 21、22 筆照比例 360', () => {
    const list = ids(22);
    const r = computePayroll(list.map((i) => sp(i)), list.map((i, k) => tx(i, k + 1)), {}, {}, [], '2026-10', {}, promo())['E']['2026-10'];
    expect(r.items.filter((i) => i.free)).toHaveLength(20);
    expect(r.earnings).toBe(20 * 799 + 2 * 360);
    expect(r.items.find((i) => i.transaction_id === 't20')?.amount).toBe(360);
  });

  it('每個月各自重算名額：9 月、10 月各 20 筆都全額', () => {
    const a = ids(20, 'a'), b = ids(20, 'b');
    const txs = [...a.map((i, k) => tx(i, k + 1, `s${i}`, '08')), ...b.map((i, k) => tx(i, k + 1, `s${i}`, '09'))];
    const r = computePayroll([...a, ...b].map((i) => sp(i)), txs, {}, {}, [], '2026-10', {}, promo())['E'];
    expect(r['2026-09'].earnings).toBe(20 * 799);
    expect(r['2026-10'].earnings).toBe(20 * 799);
  });

  it('測試帳號／健檢不佔名額', () => {
    const list = ids(21);
    const r = computePayroll(list.map((i) => sp(i)), list.map((i, k) => tx(i, k + 1)), {}, {}, [], '2026-10', {}, promo(['t00']))['E']['2026-10'];
    expect(r.items.find((i) => i.transaction_id === 't00')?.free).toBeFalsy();
    expect(r.items.filter((i) => i.free)).toHaveLength(20);
  });

  it('每位老師各自算，對帳算式仍平衡', () => {
    const r = computePayroll([sp('x', 'E'), sp('y', 'F')], [tx('x', 1), tx('y', 2)], {}, {}, [], '2026-10', {}, promo());
    expect(r['E']['2026-10'].earnings).toBe(799);
    expect(r['F']['2026-10'].earnings).toBe(799);
    const row = r['E']['2026-10'];
    const rc = payrollReconciliation([sp('x', 'E')], [tx('x', 1)], {}, 'E', '2026-10', row.earnings, 439);
    expect(rc.refundDropped).toBe(0);
  });
});
