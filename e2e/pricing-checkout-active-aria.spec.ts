/**
 * Pricing → Checkout 端到端（維持「選老師」流程）：
 *   1. /pricing 主卡片 CTA 仍導向 /experts?role=<faction>（不 bypass 選老師）。
 *   2. 使用者最終進到 /checkout/:slug/:planId 後，付款成功回跳 ?ecpay=result
 *      → useSubscriptionConfirmation 偵測 ACTIVE 訂閱
 *      → 顯示「訂閱成功，可在『我的服務』中看到。」
 *      → 自動導回 /app
 *   3. 該成功訊息必須落在 aria-live region（sonner Toaster / role=status）
 *      裡才會被螢幕閱讀器讀到。
 */
import { test, expect } from '@playwright/test';
import { seedSession, installRoutes } from './helpers/supabase-mock';

const USER = { id: 'test-user-uuid', email: 'tester@example.com' };
const PLAN_ID = 'plan-mentor-1';
const EXPERT_SLUG = 'alice';
const EXPERT_ID = 'expert-alice';
const SUCCESS_MSG = '訂閱成功，可在「我的服務」中看到。';

test.describe('Pricing → Checkout ACTIVE + aria-live 播報', () => {
  test('主卡片 CTA 仍導向 /experts（維持選老師流程）', async ({ page }) => {
    await page.goto('/pricing', { waitUntil: 'domcontentloaded' });

    const followerLink = page.locator('#follower-card').getByRole('link', { name: /選跟單派/ });
    await expect(followerLink).toHaveAttribute('href', /\/experts\?role=advisor/);

    const cultivatorLink = page.locator('#cultivator-card').getByRole('link', { name: /選修煉派/ });
    await expect(cultivatorLink).toHaveAttribute('href', /\/experts\?role=mentor/);
  });

  test('/checkout/:slug/:planId?ecpay=result → ACTIVE → toast → /app，訊息透過 aria-live 播報', async ({ page }) => {
    await seedSession(page, USER);

    let subscriptionCheckCount = 0;

    await installRoutes(page, {
      rest: {
        expert_plans: () => ({
          id: PLAN_ID,
          name: '導師週記方案',
          plan_type: 'mentor_journal',
          price_monthly: 799,
          price_yearly: 7990,
          description: '',
          features: [],
          expert_id: EXPERT_ID,
        }),
        payment_providers_safe: () => [
          {
            id: 'prov-ecpay',
            display_name: '綠界',
            provider_type: 'ecpay',
            is_active: true,
            is_default: true,
            env: 'sandbox',
          },
        ],
        experts: () => ({
          id: EXPERT_ID,
          name: 'Alice',
          slug: EXPERT_SLUG,
          avatar_url: '',
          role: 'mentor',
        }),
        member_subscriptions: () => {
          subscriptionCheckCount += 1;
          if (subscriptionCheckCount <= 1) return [];
          return [{ id: 'sub-active-1', status: 'active' }];
        },
      },
      functions: {},
    });

    await page.goto(`/checkout/${EXPERT_SLUG}/${PLAN_ID}?ecpay=result`);

    // 自動 navigate('/app')
    await page.waitForURL((url) => url.pathname === '/app', { timeout: 15_000 });

    // 成功文案可見
    const successText = page.getByText(SUCCESS_MSG);
    await expect(successText).toBeVisible({ timeout: 5_000 });

    // 訊息必須在 aria-live region 內；sonner 使用 role="status" +
    // aria-live="polite"（listitem 掛在 aria-live 容器之內）。
    const liveContainer = successText.locator(
      'xpath=ancestor::*[@aria-live][1]',
    );
    await expect(liveContainer).toHaveCount(1);
    const liveValue = await liveContainer.getAttribute('aria-live');
    expect(['polite', 'assertive']).toContain(liveValue);

    expect(subscriptionCheckCount).toBeGreaterThanOrEqual(2);
  });
});
