import { describe, it, expect } from 'vitest';
import { buildPayrollExportRows } from './payrollExport';

describe('buildPayrollExportRows', () => {
  it('每筆認列一列，附會員名字、不抽成標記與小計（筆數、會員數、合計）', () => {
    const row: any = {
      expert_id: 'e', items: [
        { transaction_id: 't1', subscription_id: 's1', paid_at: '2026-09-30T11:34:00Z', end_at: '2026-10-30T11:34:00Z', k: 1, n: 1, amount: 799, free: true },
        { transaction_id: 't2', subscription_id: 's2', paid_at: '2026-10-21T00:00:00Z', end_at: '2026-11-21T00:00:00Z', k: 1, n: 12, amount: 299.58 },
        { transaction_id: 't3', subscription_id: 's3', paid_at: '2026-10-01T00:00:00Z', end_at: '2026-11-01T00:00:00Z', k: 1, n: 1, amount: 360 },
      ],
    };
    const users: Record<string, string> = { s1: 'u1', s2: 'u2', s3: 'u1' };
    const names: Record<string, string> = { u1: '云云', u2: '' };
    const out = buildPayrollExportRows([row], {
      expertName: () => '彥愷', memberKey: (s) => (s ? users[s] : undefined),
      memberName: (s) => (s ? names[users[s]] : ''), planName: () => '修煉派',
      cycle: (s) => (s === 's2' ? 'yearly' : 'monthly'), fmtDate: (d) => d.slice(0, 10),
    });
    expect(out).toHaveLength(5);
    expect(out[1][1]).toBe('云云');
    expect(out[1][8]).toBe('是');
    expect(out[2][1]).toBe('未命名');
    expect(out[2][6]).toBe('1/12');
    expect(out[4]).toEqual(['小計', '2 位會員', '', '', '', '', '3 筆', 1458.58, '']);
  });
});
