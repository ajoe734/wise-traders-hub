/**
 * GTM dataLayer helper — single entry point for advertising / conversion
 * pixels (Meta, Google Ads, GA4) fired through GTM container GTM-PBH8J4VD.
 *
 * Internal product analytics still goes through `src/lib/analytics/events.ts`
 * (trafficTracker → own DB). Keep both — different audiences.
 *
 * Event naming follows the PascalCase convention already used in production
 * (`Purchase`, `Login`, `Function`). Stable name = stable GTM trigger.
 */

export type GtmEvent =
  | 'Login'
  | 'SignUp'
  | 'Function'
  | 'ViewExpert'
  | 'ViewPricing'
  | 'BeginCheckout'
  | 'Purchase'
  | 'SubscribeExpertClick'
  | 'LineBindStart'
  | 'LineBindSuccess'
  | 'CheckupAnalysisRun'
  | 'QuotaBlocked'
  | 'UpgradeClick';

export function gtmPush(event: GtmEvent, params: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined') return;
  try {
    const w = window as unknown as { dataLayer?: Array<Record<string, unknown>> };
    w.dataLayer = w.dataLayer || [];
    w.dataLayer.push({ event, ...params });
  } catch {
    // never let analytics break the app
  }
}
