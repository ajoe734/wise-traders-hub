import { describe, it, expect } from 'vitest';
import { evaluateRounds, computeEps, normalizePeriod, type Extraction, type SourceDoc } from '../../../supabase/functions/_shared/forwardEpsCore';

const empty = { value: null, unit: '', quote: '', doc_id: '' };
const docs: SourceDoc[] = [
  { id: 'd1', title: '緯創法說 美銀看好', text: '美銀預估緯創未來四季EPS達17.94元，給予15倍本益比', source: '經濟日報', date: '2026-09-16' },
];
const base = (o: Partial<Extraction> = {}): Extraction => ({
  period: '未來四季',
  eps_direct: { value: 17.94, unit: '元', quote: '預估緯創未來四季EPS達17.94元', doc_id: 'd1' },
  revenue: empty, gross_margin: empty, opex_ratio: empty, non_operating: empty, tax_rate: empty, shares: empty,
  forward_pe: { value: 15, unit: '倍', quote: '給予15倍本益比', doc_id: 'd1' },
  broker: '美銀', ...o,
});
const ctx = { today: '2026-10-14', ttmEps: 12.59 };

describe('前瞻 EPS 四輪守門', () => {
  it('緯創範例通過：17.94 × 15 ≈ 269，壓力測試 ≈ 215', () => {
    const v = evaluateRounds(base(), base(), docs, ctx);
    expect(v.status).toBe('passed');
    if (v.status !== 'passed') return;
    expect(v.period).toBe('NTM');
    expect(Math.round(v.eps * v.forwardPe)).toBe(269);
    expect(Math.round(v.eps * 0.8 * v.forwardPe)).toBe(215);
  });
  it('沒有原文 → 第 1 輪擋', () => expect(evaluateRounds(base(), base(), [], ctx)).toMatchObject({ status: 'blocked', round: 1 }));
  it('引句在原文找不到 → 第 2 輪擋', () => {
    const x = base({ eps_direct: { value: 17.94, unit: '元', quote: 'EPS將達17.94元創新高', doc_id: 'd1' } });
    expect(evaluateRounds(x, base(), docs, ctx)).toMatchObject({ status: 'blocked', round: 2 });
  });
  it('數字與引句不符 → 第 2 輪擋', () => {
    const x = base({ eps_direct: { value: 19, unit: '元', quote: '預估緯創未來四季EPS達17.94元', doc_id: 'd1' } });
    expect(evaluateRounds(x, base(), docs, ctx)).toMatchObject({ status: 'blocked', round: 2 });
  });
  it('只給目標價、沒寫倍數 → 擋，不反推', () => {
    expect(evaluateRounds(base({ forward_pe: empty }), base(), docs, ctx)).toMatchObject({ status: 'blocked', round: 2 });
  });
  it('券商名稱不在原文 → 擋', () => expect(evaluateRounds(base({ broker: '摩根士丹利' }), base(), docs, ctx)).toMatchObject({ status: 'blocked', round: 2 }));
  it('過去期間 → 擋', () => expect(evaluateRounds(base({ period: '2025年' }), base(), docs, ctx)).toMatchObject({ status: 'blocked', round: 2 }));
  it('缺項又沒有直接 EPS → 擋並列出缺項', () => {
    const r = computeEps(base({ eps_direct: empty }), ctx.today);
    expect('error' in r && r.error).toContain('營收');
  });
  it('兩輪不一致 → 第 3 輪擋', () => {
    const d2 = [...docs, { id: 'd2', title: '緯創', text: '預估緯創未來四季EPS達16.5元', source: 'x', date: '2026-09-10' }];
    const b = base({ eps_direct: { value: 16.5, unit: '元', quote: '預估緯創未來四季EPS達16.5元', doc_id: 'd2' } });
    expect(evaluateRounds(base(), b, d2, ctx)).toMatchObject({ status: 'blocked', round: 3 });
  });
  it('與近四季 EPS 差距超過 3 倍 → 第 4 輪擋', () => {
    expect(evaluateRounds(base(), base(), docs, { ...ctx, ttmEps: 4 })).toMatchObject({ status: 'blocked', round: 4 });
  });
  it('倍數超出 3–80 → 第 4 輪擋', () => {
    const d = [{ ...docs[0], text: docs[0].text + '，另給予90倍' }];
    const x = base({ forward_pe: { value: 90, unit: '倍', quote: '另給予90倍', doc_id: 'd1' } });
    expect(evaluateRounds(x, x, d, ctx)).toMatchObject({ status: 'blocked', round: 4 });
  });
  it('單季 EPS ×4 標簡化年化', () => {
    const d = [{ ...docs[0], text: '美銀預估緯創2026Q4 EPS 4.5元，給予15倍本益比' }];
    const x = base({ period: '2026Q4', eps_direct: { value: 4.5, unit: '元', quote: '2026Q4 EPS 4.5元', doc_id: 'd1' } });
    const v = evaluateRounds(x, x, d, ctx);
    expect(v).toMatchObject({ status: 'passed', annualized: true, eps: 18 });
  });
  it('財務項目推算：(1000 億×(30%−10%)+20)×(1−20%) ÷ 10 億股 = 17.6', () => {
    const c = (value: number, unit: string) => ({ value, unit, quote: String(value), doc_id: 'd1' });
    const r = computeEps(base({ eps_direct: empty, revenue: c(1000, '億'), gross_margin: c(30, '%'), opex_ratio: c(10, '%'), non_operating: c(20, '億'), tax_rate: c(20, '%'), shares: c(10, '億股') }), ctx.today);
    expect('eps' in r && Math.round(r.eps * 10) / 10).toBe(17.6);
  });
  it('期間標準化', () => {
    expect(normalizePeriod('2027年', ctx.today)).toBe('FY2027');
    expect(normalizePeriod('未來12個月', ctx.today)).toBe('NTM');
    expect(normalizePeriod('2024', ctx.today)).toBeNull();
  });
});
