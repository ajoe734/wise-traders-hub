import { beforeEach, describe, expect, it, vi } from 'vitest';

const raw = vi.fn();
vi.mock('@/lib/analytics/events', () => ({ trackRaw: (...a: unknown[]) => raw(...a) }));

import { getFirstTouch, normalizeFirstTouch, trackCheckoutEntry, ga4Purchase, ga4Lead, ga4SignUp } from '@/lib/analytics/marketing';
import { conversionRate, toCsv } from '@/lib/analytics/marketingReport';

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); raw.mockClear();
  (window as any).dataLayer = [];
});

describe('首次接觸來源', () => {
  it('沒有 UTM 時四個欄位都記為 direct', () => {
    expect(normalizeFirstTouch(null)).toMatchObject({ utm_source: 'direct', utm_medium: 'direct', utm_campaign: 'direct', utm_content: 'direct' });
  });
  it('讀取 30 天內首次接觸並帶進站時間', () => {
    const at = Date.UTC(2026, 9, 1);
    localStorage.setItem('lf_attr_v1', JSON.stringify({ utm_source: 'ig', utm_medium: 'mia', utm_campaign: 'oct', first_touch_at: at, locked_until: Date.now() + 86400_000 }));
    expect(getFirstTouch()).toMatchObject({ utm_source: 'ig', utm_medium: 'mia', utm_campaign: 'oct', utm_content: 'direct', first_touch_at: new Date(at).toISOString() });
  });
  it('超過 30 天到期後改記 direct', () => {
    localStorage.setItem('lf_attr_v1', JSON.stringify({ utm_source: 'ig', locked_until: Date.now() - 1 }));
    expect(getFirstTouch().utm_source).toBe('direct');
  });
});

describe('進入結帳一定先有瀏覽方案', () => {
  it('直接連結進結帳：先送 pricing_view 再送 checkout_open', () => {
    trackCheckoutEntry({ plan_id: 'p1' });
    expect(raw.mock.calls.map((c) => c[0])).toEqual(['pricing_view', 'checkout_open']);
  });
  it('已看過方案就不重複送', () => {
    sessionStorage.setItem('lf_pricing_viewed', '1');
    trackCheckoutEntry({ plan_id: 'p1' });
    expect(raw.mock.calls.map((c) => c[0])).toEqual(['checkout_open']);
  });
});

describe('GA4 事件', () => {
  it('purchase 帶商品名稱與金額', () => {
    ga4Purchase({ item_name: '彥愷老師 週記', value: 799 });
    expect((window as any).dataLayer[0]).toMatchObject({ event: 'purchase', value: 799, currency: 'TWD', ecommerce: { items: [{ item_name: '彥愷老師 週記', price: 799 }] } });
  });
  it('sign_up 與 generate_lead 使用 GA4 建議名稱', () => {
    ga4SignUp('email'); ga4Lead('taipei-meetup');
    expect((window as any).dataLayer.map((d: any) => d.event)).toEqual(['sign_up', 'generate_lead']);
  });
});

describe('行銷來源報表', () => {
  it('轉換率 = 購買 ÷ 訪客，訪客 0 不給數字', () => {
    expect(conversionRate(5, 200)).toBe(0.025);
    expect(conversionRate(1, 0)).toBeNull();
  });
  it('CSV 只有彙總欄位且防公式注入', () => {
    const csv = toCsv([{ utm_medium: '=cmd', utm_campaign: 'c', utm_content: 'x', visitors: 10, signups: 2, purchases: 1, revenue: 799, leads: 3 }]);
    expect(csv).not.toMatch(/email|姓名|電話/i);
    expect(csv.split('\n')[1].startsWith("'=cmd")).toBe(true);
  });
});
