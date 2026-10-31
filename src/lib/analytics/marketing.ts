/**
 * 行銷來源（首次接觸）與 GA4 建議事件。
 *
 * - 首次接觸存在 localStorage `lf_attr_v1`（useAttributionTracking 寫入，30 天有效）。
 * - 沒有 UTM 時一律記為 `direct`。
 * - GA4 事件經 GTM dataLayer 送出（sign_up / purchase / generate_lead），
 *   GTM 需有對應 GA4 事件代碼才會進 GA4。
 */
import { gtmPush } from '@/lib/analytics/gtm';
import { trackRaw } from '@/lib/analytics/events';

export interface FirstTouch {
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  first_touch_at: string | null;
  visitor_id: string | null;
}

export const DIRECT = 'direct';

export function normalizeFirstTouch(raw: {
  utm_source?: string | null; utm_medium?: string | null; utm_campaign?: string | null; utm_content?: string | null;
  first_touch_at?: number | string | null; visitor_id?: string | null;
} | null): FirstTouch {
  const v = (s?: string | null) => (s && s.trim() ? s.trim() : DIRECT);
  const at = raw?.first_touch_at;
  return {
    utm_source: v(raw?.utm_source),
    utm_medium: v(raw?.utm_medium),
    utm_campaign: v(raw?.utm_campaign),
    utm_content: v(raw?.utm_content),
    first_touch_at: at ? new Date(at).toISOString() : null,
    visitor_id: raw?.visitor_id ?? null,
  };
}

export function getFirstTouch(): FirstTouch {
  let visitor: string | null = null;
  try { visitor = localStorage.getItem('lf_visitor_id'); } catch { /* noop */ }
  let a: (Parameters<typeof normalizeFirstTouch>[0] & { locked_until?: number }) | null = null;
  try {
    const raw = localStorage.getItem('lf_attr_v1');
    a = raw ? JSON.parse(raw) : null;
    if (a?.locked_until && a.locked_until < Date.now()) a = null;
  } catch { a = null; }
  return normalizeFirstTouch(a ? { ...a, visitor_id: a.visitor_id ?? visitor } : { visitor_id: visitor });
}

export function ga4SignUp(method: 'email' | 'line') {
  gtmPush('sign_up', { method, ...utmParams() });
}

export function ga4Purchase(p: { item_name: string; value: number; item_id?: string; transaction_id?: string }) {
  gtmPush('purchase', {
    currency: 'TWD',
    value: p.value,
    transaction_id: p.transaction_id,
    ecommerce: { currency: 'TWD', value: p.value, transaction_id: p.transaction_id, items: [{ item_id: p.item_id, item_name: p.item_name, price: p.value, quantity: 1 }] },
    ...utmParams(),
  });
}

export function ga4Lead(eventSlug: string) {
  gtmPush('generate_lead', { event_slug: eventSlug, ...utmParams() });
}

function utmParams() {
  const t = getFirstTouch();
  return { utm_source: t.utm_source, utm_medium: t.utm_medium, utm_campaign: t.utm_campaign, utm_content: t.utm_content };
}

const PRICING_SEEN_KEY = 'lf_pricing_viewed';

export function markPricingViewed() {
  try { sessionStorage.setItem(PRICING_SEEN_KEY, '1'); } catch { /* noop */ }
}

/**
 * 進入結帳：所有路徑（方案頁、專家頁、直接連結、LINE 連結、續訂卡）
 * 都保證先有一筆「瀏覽方案」，再送「進入結帳」，漏斗才不會倒掛。
 */
export function trackCheckoutEntry(props: Record<string, unknown>) {
  let seen = false;
  try { seen = sessionStorage.getItem(PRICING_SEEN_KEY) === '1'; } catch { /* noop */ }
  if (!seen) {
    trackRaw('pricing_view', { ...props, entry: 'checkout_direct' });
    markPricingViewed();
  }
  trackRaw('checkout_open', props);
}
