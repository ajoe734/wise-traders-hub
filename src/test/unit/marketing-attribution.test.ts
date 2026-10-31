import { beforeEach, describe, expect, it, vi } from 'vitest';

const raw = vi.fn();
vi.mock('@/lib/analytics/events', () => ({ trackRaw: (...a: unknown[]) => raw(...a) }));

import { getFirstTouch, normalizeFirstTouch, trackCheckoutEntry, ga4Purchase, ga4Lead, ga4SignUp } from '@/lib/analytics/marketing';
import { ga4PageView, stripPii } from '@/lib/analytics/ga4';
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

describe('GA4 事件（gtag 直送 G-LGJNXMX3DM）', () => {
  const calls: unknown[][] = [];
  beforeEach(() => { calls.length = 0; (window as any).gtag = (...a: unknown[]) => calls.push(a); window.history.pushState({}, '', '/'); });
  it('purchase 帶商品名稱、金額、幣別 TWD', () => {
    ga4Purchase({ item_name: '彥愷老師 週記', value: 799 });
    expect(calls[0]).toEqual(['event', 'purchase', expect.objectContaining({ value: 799, currency: 'TWD', send_to: 'G-LGJNXMX3DM', items: [expect.objectContaining({ item_name: '彥愷老師 週記', price: 799 })] })]);
  });
  it('sign_up 與 generate_lead 用 gtag 送，不推進 GTM dataLayer', () => {
    ga4SignUp('email'); ga4Lead('taipei-meetup');
    expect(calls.map((c) => c[1])).toEqual(['sign_up', 'generate_lead']);
    expect((window as any).dataLayer.filter((d: any) => d && d.event)).toEqual([]);
  });
  it('後台頁不送任何 GA4 事件', () => {
    for (const p of ['/company/traffic', '/admin', '/admin/x']) {
      window.history.pushState({}, '', p);
      ga4SignUp('email'); ga4PageView(p);
    }
    expect(calls).toEqual([]);
  });
  it('page_view 送路徑，網址中的 email 參數被移除', () => {
    ga4PageView('/experts', '?utm_source=ig&email=a@b.com');
    expect(calls[0][2]).toMatchObject({ page_path: '/experts?utm_source=ig' });
  });
  it('事件參數不含姓名、email、電話', () => {
    expect(stripPii({ name: '王', email: 'a@b.com', phone: '0912', user_email: 'x', note: 'c@d.com', items: [{ item_name: '週記' }] })).toEqual({ items: [{ item_name: '週記' }] });
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
