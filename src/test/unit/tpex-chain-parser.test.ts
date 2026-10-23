import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseChainPage } from '../../../supabase/functions/_shared/tpexChainParser';

const html = readFileSync('src/test/fixtures/tpex/L000.html', 'utf8');
const rows = parseChainPage(html, 'L000');

describe('櫃買產業價值鏈頁面解析', () => {
  it('取出產業鏈名稱', () => expect(rows[0].chain).toBe('印刷電路板'));
  it('富喬、建榮、德宏在上游玻纖布', () => {
    for (const s of ['1815', '5340', '5475']) {
      expect(rows.find((r) => r.symbol === s && r.subCode === 'L100')).toMatchObject({ tier: '上游', subItem: '玻璃纖維/玻纖布' });
    }
  });
  it('台光電、台燿在中游銅箔基板', () => {
    for (const s of ['2383', '6274']) expect(rows.find((r) => r.symbol === s && r.subCode === 'L630')?.tier).toBe('中游');
  });
  it('外國企業連結不算台股', () => expect(rows.every((r) => /^\d{4}/.test(r.symbol))).toBe(true));
});
