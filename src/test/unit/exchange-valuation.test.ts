import { describe, it, expect } from 'vitest';
import { parseTwseBwibbu, parseTpexPera, tpexPeraUrl } from '../../../supabase/functions/_shared/exchangeValuation';

describe('交易所每日本益比解析', () => {
  it('證交所：台泥本益比「-」→ null，亞泥 9.79', () => {
    const r = parseTwseBwibbu({ stat: 'OK', data: [['1101', '台泥', '25.20', '3.17', 114, '-', '0.82', '115/2'], ['1102', '亞泥', '35.45', '6.49', 114, '9.79', '0.68', '115/2']] }, '2026-10-06');
    expect(r[0]).toMatchObject({ symbol: '1101', per: null, pbr: 0.82, dividend_yield: 3.17, market: 'TWSE' });
    expect(r[1].per).toBe(9.79);
  });
  it('櫃買：代號去空白，本益比 10.02、淨值比 1.59、殖利率 0.93', () => {
    const r = parseTpexPera({ tables: [{ data: [['1240', '茂生農經  ', '10.02', '0.5', 114, '0.93', '1.59', '115Q2']] }] }, '2026-10-06');
    expect(r[0]).toMatchObject({ symbol: '1240', per: 10.02, pbr: 1.59, dividend_yield: 0.93, market: 'TPEx' });
  });
  it('櫃買網址用民國年', () => expect(tpexPeraUrl('2026-10-06')).toContain('d=115/10/06'));
});
