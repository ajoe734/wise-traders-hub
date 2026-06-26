/**
 * Subscription funnel — Pricing → Checkout → 付款成功 → /app
 *
 * 對應後台 `/company/funnel` 漏斗（ViewPricing → UpgradeClick → BeginCheckout → Purchase）。
 * 全程攔 supabase REST/functions（不打真實後端），同時攔 traffic-ingest
 * 確認埋點 payload 真的有送出。
 *
 * 任何修改 Pricing / Checkout / useSubscriptionConfirmation / trafficTracker
 * 都應跑此測試。每條 plan_type 一個 case，確保三條路徑都活著。
 */
import { test, expect } from '@playwright/test';
import { seedSession, installRoutes } from './helpers/supabase-mock';
import { installFunnelCollector, readFunnelEvents, eventNames } from './helpers/funnel-events';

const USER = { id: 'funnel-user', email: 'funnel@test.io' };
const EXPERT_ID = 'expert-funnel';
const EXPERT_SLUG = 'funnel-alice';

const PLAN_VARIANTS = [
  { id: 'plan-l1',   plan_type: 'analyst_signal_l1',        name: '訊號方案', price: 599 },
  { id: 'plan-l2',   plan_type: 'analyst_signal_diag_l2',   name: '訊號 + 健檢', price: 999 },
  { id: 'plan-ment', plan_type: 'mentor_weekly_journal',    name: '週記方案', price: 399 },
] as const;

test.describe('訂閱漏斗 mock e2e — ViewPricing → BeginCheckout → Purchase', () => {
  for (const plan of PLAN_VARIANTS) {
    test(`${plan.plan_type}：pricing_view → checkout_open → checkout_success 事件鏈完整 + 自動導回 /app`, async ({ page }) => {
      await seedSession(page, USER);
      await installFunnelCollector(page);

      let subCalls = 0;
      await installRoutes(page, {
        rest: {
          expert_plans: () => ({
            id: plan.id,
            name: plan.name,
            plan_type: plan.plan_type,
            price_monthly: plan.price,
            price_yearly: plan.price * 10,
            description: '',
            features: [],
            expert_id: EXPERT_ID,
          }),
          payment_providers_safe: () => [
            { id: 'prov-ecpay', display_name: '綠界', provider_type: 'ecpay', is_active: true, is_default: true, env: 'sandbox' },
          ],
          experts: () => ({ id: EXPERT_ID, name: 'Alice', slug: EXPERT_SLUG, avatar_url: '', role: 'advisor' }),
          member_subscriptions: () => {
            subCalls += 1;
            return subCalls <= 1 ? [] : [{ id: 'sub-1' }];
          },
        },
        functions: {},
      });

      // 1) Pricing 頁觸發 pricing_view
      await page.goto('/pricing');
      await page.waitForLoadState('domcontentloaded');
      let events = await readFunnelEvents(page);
      expect(eventNames(events), `pricing_view 必須在 /pricing 載入時送出`).toContain('pricing_view');

      // 2) 直接走 /checkout/:slug/:planId?ecpay=result 模擬綠界回跳成功流
      //    （Pricing 點按進入 checkout 的 click 行為由 PricingPlanCard 單元測試守住；
      //     這裡只關心 checkout 進入後事件 + 成功處理）
      await page.goto(`/checkout/${EXPERT_SLUG}/${plan.id}?ecpay=result`);

      // 3) 應自動偵測 active subscription → 導回 /app
      await page.waitForURL((u) => u.pathname === '/app', { timeout: 15_000 });

      // 4) 事件鏈：checkout_open + checkout_success 必須都有
      events = await readFunnelEvents(page);
      const names = eventNames(events);
      expect(names, `checkout_open 必須在 /checkout 載入時送出（plan=${plan.plan_type}）`).toContain('checkout_open');
      expect(names, `checkout_success 必須在偵測到 active 訂閱後送出（plan=${plan.plan_type}）`).toContain('checkout_success');

      // 5) checkout_open payload 必須帶 plan_id（後台漏斗用來分流）
      const openEv = events.find((e) => e.event_name === 'checkout_open');
      expect(openEv?.event_props).toMatchObject({ plan_id: plan.id });
    });
  }
});
