import { describe, it, expect } from 'vitest';
import { firstNFreeRanks } from './first20Promo';

const mk = (i: number, extra: Record<string, unknown> = {}) => ({
  transaction_id: `t${String(i).padStart(2, '0')}`, expert_id: 'e', status: 'paid',
  paid_at: `2026-06-${String(i).padStart(2, '0')}T00:00:00Z`, ...extra,
});

describe('firstNFreeRanks（前 20 筆不抽成）', () => {
  it('第 20 筆不抽成、第 21 筆照比例', () => {
    const s = firstNFreeRanks(Array.from({ length: 21 }, (_, i) => mk(i + 1)));
    expect(s.has('t20')).toBe(true);
    expect(s.has('t21')).toBe(false);
  });
  it('前 20 筆有一筆全額退款，第 21 筆遞補', () => {
    const txs = Array.from({ length: 21 }, (_, i) => mk(i + 1, i === 4 ? { fullyRefunded: true } : {}));
    const s = firstNFreeRanks(txs);
    expect(s.has('t05')).toBe(false);
    expect(s.has('t21')).toBe(true);
  });
  it('健檢與測試帳號不佔名額', () => {
    const txs = [mk(1, { checkup: true }), mk(2, { tester: true }), ...Array.from({ length: 20 }, (_, i) => mk(i + 3))];
    const s = firstNFreeRanks(txs);
    expect(s.has('t01')).toBe(false);
    expect(s.has('t02')).toBe(false);
    expect(s.has('t22')).toBe(true);
  });
  it('每位老師各自算 20 筆', () => {
    const txs = [...Array.from({ length: 20 }, (_, i) => mk(i + 1)), mk(25, { expert_id: 'e2', transaction_id: 'x' })];
    expect(firstNFreeRanks(txs).has('x')).toBe(true);
  });
});
