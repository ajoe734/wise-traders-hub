/**
 * F3 — 訂閱取消 / 續訂 mock e2e
 *
 * 對應 traffic_events.event_name：
 *   - subscription_cancel_click（/app/account 取消訂閱對話框「確認取消」）
 *   - subscription_renew_click（/app/account「立即續訂」按鈕，到期 ≤ 30 天才出現）
 *
 * 攔截 supabase REST + traffic-ingest，不打真實後端。
 * 任何修改 SubscriptionCard / useAccountData / cancelSubscriptionInDB 都應跑此測試。
 */
import { test, expect } from '@playwright/test';
import { seedSession, installRoutes } from './helpers/supabase-mock';
import { installFunnelCollector, readFunnelEvents, eventNames } from './helpers/funnel-events';

const USER = { id: 'cancel-user', email: 'cancel@test.io' };
const PLAN_ID = 'plan-cancel-1';
const EXPERT_ID = 'expert-c1';
const EXPERT_SLUG = 'cancel-alice';

function baseRoutes(extra: { subStatus?: 'active'; expiresInDays?: number; autoRenew?: boolean; billing?: 'monthly' | 'yearly' } = {}) {
  const days = extra.expiresInDays ?? 60;
  const expires = new Date(Date.now() + days * 86400_000).toISOString();
  return {
    rest: {
      member_subscriptions: ({ method }: { method: string }) => {
        if (method === 'PATCH') return [{ id: 'sub-1' }];
        return [{
          id: 'sub-1',
          plan_id: PLAN_ID,
          status: extra.subStatus ?? 'active',
          auto_renew: extra.autoRenew ?? false,
          billing_cycle: extra.billing ?? 'monthly',
          started_at: new Date(Date.now() - 30 * 86400_000).toISOString(),
          expires_at: expires,
          canceled_at: null,
          expert_plans: {
            name: '訊號方案',
            price_monthly: 599,
            price_yearly: 5990,
            experts: { name: 'Alice', slug: EXPERT_SLUG },
          },
        }];
      },
      expert_plans: () => [{
        id: PLAN_ID, name: '訊號方案', plan_type: 'analyst_signal_l1',
        price_monthly: 599, price_yearly: 5990, expert_id: EXPERT_ID,
      }],
      experts: () => [{ id: EXPERT_ID, slug: EXPERT_SLUG, name: 'Alice', role: 'advisor', avatar_url: null, status: 'active' }],
      remittance_orders: () => [],
      expert_line_channels_public: () => [],
      profiles: () => null,
      user_roles: () => [],
    },
    functions: {},
  };
}

test.describe('F3 訂閱取消 / 續訂事件', () => {
  test('取消訂閱：點「確認取消」應送 subscription_cancel_click', async ({ page }) => {
    await seedSession(page, USER);
    await installFunnelCollector(page);
    await installRoutes(page, baseRoutes({ billing: 'monthly', expiresInDays: 60 }));

    await page.goto('/app/account');
    await page.getByRole('button', { name: /取消訂閱/ }).first().click();
    await page.getByRole('button', { name: /確認取消/ }).click();

    const events = await readFunnelEvents(page);
    expect(eventNames(events)).toContain('subscription_cancel_click');
    const ev = events.find((e) => e.event_name === 'subscription_cancel_click');
    expect(ev?.event_props).toMatchObject({ plan_id: PLAN_ID });
  });

  test('續訂：到期 ≤ 30 天時點「立即續訂」應送 subscription_renew_click', async ({ page }) => {
    await seedSession(page, USER);
    await installFunnelCollector(page);
    await installRoutes(page, baseRoutes({ billing: 'monthly', expiresInDays: 10 }));

    await page.goto('/app/account');
    const renewLink = page.getByRole('link', { name: /立即續訂/ });
    await expect(renewLink).toBeVisible();
    const href = await renewLink.getAttribute('href');
    expect(href).toMatch(/^\/app\/checkout\//);
    expect(href).not.toContain('/checkout?plan=');
    // Keep the current document alive so the in-page funnel collector can read the click event.
    await renewLink.evaluate((node) => {
      node.addEventListener('click', (event) => event.preventDefault(), { once: true });
      (node as HTMLElement).click();
    });
    await page.waitForTimeout(1_600);

    const events = await readFunnelEvents(page);
    expect(eventNames(events)).toContain('subscription_renew_click');
    const ev = events.find((e) => e.event_name === 'subscription_renew_click');
    expect(ev?.event_props).toMatchObject({ plan_id: PLAN_ID });
  });

  test('過期但 status 仍為 active 時，「立即續訂」導向 App checkout 且帳號頁不顯示有效訂閱卡', async ({ page }) => {
    await seedSession(page, USER);
    await installFunnelCollector(page);
    await installRoutes(page, baseRoutes({ billing: 'monthly', expiresInDays: -0.5 }));

    await page.goto('/app/account');
    await expect(page.getByRole('link', { name: /立即續訂/ })).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('尚無訂閱')).toBeVisible();
    await expect(page.getByText('到期後手動續訂')).toHaveCount(0);

    const renewLink = page.getByRole('link', { name: /立即續訂/ });
    const href = await renewLink.getAttribute('href');
    expect(href).toBe(`/app/checkout/${EXPERT_SLUG}/${PLAN_ID}?cycle=monthly&utm_source=account_banner&utm_campaign=renewal`);
  });

  test('legacy 續訂網址 /:slug/checkout?plan=... 會導到 /app/checkout/:slug/:planId', async ({ page }) => {
    await seedSession(page, USER);
    await installRoutes(page, baseRoutes({ billing: 'monthly', expiresInDays: 10 }));

    await page.goto(
      `/${EXPERT_SLUG}/checkout?plan=${PLAN_ID}&cycle=monthly&utm_source=account_banner&utm_campaign=renewal`,
    );

    await expect(page).toHaveURL((url) => {
      expect(url.pathname).toBe(`/app/checkout/${EXPERT_SLUG}/${PLAN_ID}`);
      expect(url.searchParams.get('plan')).toBeNull();
      expect(url.searchParams.get('cycle')).toBe('monthly');
      expect(url.searchParams.get('utm_source')).toBe('account_banner');
      expect(url.searchParams.get('utm_campaign')).toBe('renewal');
      return true;
    });
  });
});
