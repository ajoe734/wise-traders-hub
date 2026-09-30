/**
 * buildSellTradeEntry / validateSellEntry — 「記賣出並刪除」純函式層。
 *
 * 硬合約：
 *  - 交易列與 TradeTab.applyCorrections 同形狀（12-key + id/qa），
 *    mergeTradeIntoHoldings 直接可吃。
 *  - 日期／時間沿用 zh-TW 非補零慣例（YYYY/M/D + HH:mm）。
 *  - oversell / 非正數一律拒絕，不產生 entry。
 */
import { describe, it, expect } from 'vitest';
import { buildSellTradeEntry, validateSellEntry } from '@/checkup/lib/holdingDeleteService';
import { mergeTradeIntoHoldingsShapeContract } from './sellEntryShape';

describe('validateSellEntry', () => {
  it('合法：全數賣出', () => {
    expect(validateSellEntry({ qty: 1000, price: 618, heldQty: 1000 })).toBeNull();
  });

  it('合法：部分賣出', () => {
    expect(validateSellEntry({ qty: 300, price: 618, heldQty: 1000 })).toBeNull();
  });

  it('拒絕：賣超', () => {
    expect(validateSellEntry({ qty: 1001, price: 618, heldQty: 1000 })).toBe('oversell');
  });

  it('拒絕：股數非正數', () => {
    expect(validateSellEntry({ qty: 0, price: 618, heldQty: 1000 })).toBe('invalid-qty');
    expect(validateSellEntry({ qty: -5, price: 618, heldQty: 1000 })).toBe('invalid-qty');
    expect(validateSellEntry({ qty: NaN, price: 618, heldQty: 1000 })).toBe('invalid-qty');
  });

  it('拒絕：價格非正數', () => {
    expect(validateSellEntry({ qty: 100, price: 0, heldQty: 1000 })).toBe('invalid-price');
    expect(validateSellEntry({ qty: 100, price: -1, heldQty: 1000 })).toBe('invalid-price');
  });
});

describe('buildSellTradeEntry', () => {
  const now = new Date('2026-09-30T03:30:00.000Z'); // 台北 11:30

  it('全數賣出：12-key 交易列 + tradeLog 的 id/qa', () => {
    const r = buildSellTradeEntry({ code: '2338', name: '光罩', qty: 1000, price: 61.8, heldQty: 1000, now });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const e = r.entry;
    expect(e.action).toBe('賣出');
    expect(e.code).toBe('2338');
    expect(e.name).toBe('光罩');
    expect(e.qty).toBe(1000);
    expect(e.price).toBe(61.8);
    expect(e.priceSource).toBe('manual');
    expect(e.market_price).toBeNull();
    expect(e.amount).toBeNull();
    expect(e.total_cost).toBeNull();
    expect(e.fee).toBeNull();
    expect(e.qa).toEqual([]);
    expect(e.id).toBeTruthy();
    // zh-TW 非補零慣例；時間與 manualTradeEntry.formatTradeTime 同源（zh-TW 12 小時制）
    expect(e.date).toMatch(/^2026\/9\/30$/);
    expect(e.time).toMatch(/^(上午|下午)\d{2}:\d{2}$/);
  });

  it('缺名稱時回退代碼', () => {
    const r = buildSellTradeEntry({ code: '6706', qty: 1, price: 500, heldQty: 1, now });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entry.name).toBe('6706');
  });

  it('拒絕：oversell / 非正數 / 空代碼，不產生 entry', () => {
    expect(buildSellTradeEntry({ code: '2338', qty: 2000, price: 61.8, heldQty: 1000, now })).toEqual({ ok: false, error: 'oversell' });
    expect(buildSellTradeEntry({ code: '2338', qty: 0, price: 61.8, heldQty: 1000, now })).toEqual({ ok: false, error: 'invalid-qty' });
    expect(buildSellTradeEntry({ code: '2338', qty: 100, price: 0, heldQty: 1000, now })).toEqual({ ok: false, error: 'invalid-price' });
    expect(buildSellTradeEntry({ code: '', qty: 100, price: 61.8, heldQty: 1000, now })).toEqual({ ok: false, error: 'invalid-code' });
  });

  it('mergeTradeIntoHoldings 形狀契約：全數賣出移出持倉、部分賣出扣股數', () => {
    expect(mergeTradeIntoHoldingsShapeContract()).toBe(true);
  });
});
