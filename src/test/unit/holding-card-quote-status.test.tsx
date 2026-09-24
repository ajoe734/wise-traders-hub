/**
 * 新增持股卡片報價狀態（2026-09-24）：
 *  根因：成交輸入把 priceSource=manual、priceUpdatedAt=輸入當下寫進持倉，
 *  mergeQuoteIntoHolding 的「不倒退」規則把時間較早的市場報價當成舊資料丟掉，
 *  卡片永遠顯示成交價且 SR 文字宣稱「現價已更新」。
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { mergeQuoteIntoHolding } from '@/checkup/lib/quoteRequestGate';
import HoldingCardPriceTrack, { holdingQuoteStatus } from '@/checkup/components/freecheckup/_ui/holdingCard/HoldingCardPriceTrack';

const calc = (h: any, p: number) => ({ value: p * h.qty, pnl: (p - h.cost) * h.qty, pct: (p / h.cost - 1) * 100 });
const P = { dec: null, meta: null, muteColor: '#999', subColor: '#333' };
const added = { code: '1216', name: '統一', qty: 1000, cost: 80, price: 80, priceSource: 'manual', priceUpdatedAt: '2026-09-24T05:50:00Z' };

describe('新增持股報價', () => {
  it('成交價不會擋掉時間較早的市場報價', () => {
    const next = mergeQuoteIntoHolding(added, { price: 88.4, source: 'db', updatedAt: '2026-09-24T05:30:00Z' } as any, calc, '2026-09-24T05:51:00Z');
    expect(next.price).toBe(88.4);
    expect(next.priceSource).toBe('db');
    expect(next.qty).toBe(1000);
    expect(next.cost).toBe(80);
  });
  it('示範種子價（demo）不擋市場報價，且卡片仍為 ready（不顯示載入中）', () => {
    const demo = { ...added, priceSource: 'demo', priceUpdatedAt: '2026-09-24T05:50:00Z' };
    expect(holdingQuoteStatus(demo)).toBe('ready');
    const next = mergeQuoteIntoHolding(demo, { price: 88.4, source: 'pending_close', updatedAt: '2026-09-24T05:30:00Z', state: 'pending', reason: 'no_bars' } as any, calc, 'x');
    expect(next.priceSource).toBe('pending_close');
    expect(next.qty).toBe(1000);
  });
  it('市場報價之間仍不倒退', () => {
    const live = { ...added, price: 90, priceSource: 'realtime', priceUpdatedAt: '2026-09-24T05:50:00Z' };
    expect(mergeQuoteIntoHolding(live, { price: 88.4, source: 'db', updatedAt: '2026-09-24T05:30:00Z' } as any, calc, 'x')).toBe(live);
  });
  it('狀態三選一：loading / none / ready', () => {
    expect(holdingQuoteStatus(added)).toBe('loading');
    expect(holdingQuoteStatus({ ...added, priceError: '尚無報價' })).toBe('none');
    expect(holdingQuoteStatus({ ...added, price: 0, priceSource: null })).toBe('loading');
    expect(holdingQuoteStatus({ ...added, priceSource: 'db' })).toBe('ready');
    expect(holdingQuoteStatus({ ...added, priceSource: 'pending_close', priceError: '收盤待補' })).toBe('ready');
  });
  it('卡片價格列永不空白', () => {
    const { rerender } = render(<HoldingCardPriceTrack {...P} h={added} />);
    expect(screen.getByTestId('card-quote-status').textContent).toBe('報價載入中…');
    rerender(<HoldingCardPriceTrack {...P} h={{ ...added, price: 0, cost: 0, priceError: '尚無報價' }} />);
    expect(screen.getByTestId('card-quote-status').textContent).toBe('暫無報價');
    rerender(<HoldingCardPriceTrack {...P} h={{ ...added, price: 88.4, priceSource: 'db' }} />);
    expect(screen.queryByTestId('card-quote-status')).toBeNull();
    expect(screen.getByText(/現價 88\.4/)).toBeTruthy();
  });
});
