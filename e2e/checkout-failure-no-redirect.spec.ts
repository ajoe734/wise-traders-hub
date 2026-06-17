/**
 * Checkout 付款失敗 / 未完成 → 不導回 /app、不顯示成功 toast，並顯示對應錯誤提示。
 *
 * 涵蓋三條失敗/未完成路徑：
 *   A. LINE Pay 使用者取消 (`?linepay=cancel`)
 *      → CheckoutResultDialog 顯示「您已取消付款」、URL 保留在 /checkout/...
 *   B. LINE Pay 回跳 confirm 後端回 success:false (`?linepay=confirm&transactionId=...`)
 *      → CheckoutResultDialog 顯示「付款確認失敗」、URL 保留
 *   C. ECPay 回跳 (`?ecpay=result`) 但 member_subscriptions 一直回空
 *      → useSubscriptionConfirmation 不應提早 finish；4 秒內 URL 不變、不顯示成功 toast
 */
import { test, expect } from '@playwright/test';
import { seedSession, installRoutes } from './helpers/supabase-mock';

const USER = { id: 'test-user-uuid', email: 'tester@example.com' };
const PLAN_ID = 'plan-1';
const EXPERT_SLUG = 'alice';
const EXPERT_ID = 'expert-1';

function baseRestHandlers(overrides?: Record<string, any>) {
  return {
    expert_plans: () => ({
      id: PLAN_ID,
      name: '訊號方案',
      plan_type: 'analyst_signal_l1',
      price_monthly: 599,
      price_yearly: 5990,
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
      role: 'advisor',
    }),
    member_subscriptions: () => [],
    ...overrides,
  };
}

test.describe('Checkout 付款失敗 / 未完成不導回 /app', () => {
  test('A. LINE Pay 取消 → 顯示「您已取消付款」且 URL 不變', async ({ page }) => {
    await seedSession(page, USER);
    await installRoutes(page, { rest: baseRestHandlers(), functions: {} });

    const target = `/checkout/${EXPERT_SLUG}/${PLAN_ID}?linepay=cancel`;
    await page.goto(target);

    await expect(page.getByText('您已取消付款')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('訂閱失敗')).toBeVisible();
    // 未顯示成功 toast
    await expect(page.getByText('訂閱成功，可在「我的服務」中看到。')).toHaveCount(0);
    // URL 仍在 checkout
    expect(new URL(page.url()).pathname).toBe(`/checkout/${EXPERT_SLUG}/${PLAN_ID}`);
  });

  test('B. LINE Pay confirm 後端 success:false → 顯示「付款確認失敗」且 URL 不變', async ({ page }) => {
    await seedSession(page, USER);
    await installRoutes(page, {
      rest: baseRestHandlers(),
      functions: {
        'confirm-linepay': () => ({ success: false, message: 'transaction not found' }),
      },
    });

    await page.goto(
      `/checkout/${EXPERT_SLUG}/${PLAN_ID}?linepay=confirm&transactionId=fake-tx&orderId=fake-order`,
    );

    await expect(page.getByText('付款確認失敗')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('訂閱失敗')).toBeVisible();
    await expect(page.getByText('訂閱成功，可在「我的服務」中看到。')).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe(`/checkout/${EXPERT_SLUG}/${PLAN_ID}`);
  });

  test('C. ECPay 回跳但訂閱未出現 → 4 秒內不導回 /app、不顯示成功 toast', async ({ page }) => {
    await seedSession(page, USER);
    let subscriptionCheckCount = 0;
    await installRoutes(page, {
      rest: baseRestHandlers({
        member_subscriptions: () => {
          subscriptionCheckCount += 1;
          return []; // 永遠回空 — 模擬付款其實沒成功
        },
      }),
      functions: {},
    });

    const target = `/checkout/${EXPERT_SLUG}/${PLAN_ID}?ecpay=result`;
    await page.goto(target);

    // 等待 4 秒，足以讓 useSubscriptionConfirmation 至少跑一次 checkExisting + 一次 poll (5s 間隔的第一輪 setInterval 還沒觸發，但 checkExisting 立即執行)
    await page.waitForTimeout(4_000);

    // URL 必須維持在 checkout，不能被誤導回 /app
    expect(new URL(page.url()).pathname).toBe(`/checkout/${EXPERT_SLUG}/${PLAN_ID}`);
    await expect(page.getByText('訂閱成功，可在「我的服務」中看到。')).toHaveCount(0);
    await expect(page.getByText('訂閱成功 🎉')).toHaveCount(0);

    // 至少被查過一次（useCheckoutData + useSubscriptionConfirmation.checkExisting）
    expect(subscriptionCheckCount).toBeGreaterThanOrEqual(2);
  });
});
