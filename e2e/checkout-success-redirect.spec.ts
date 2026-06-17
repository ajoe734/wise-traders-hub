/**
 * Checkout 付款成功後行為：
 *   1. useSubscriptionConfirmation 透過 polling/realtime 偵測到 ACTIVE 訂閱
 *   2. 顯示 sonner toast「訂閱成功，可在『我的服務』中看到。」
 *   3. 自動 navigate('/app', { replace: true })
 *
 * 採 ?ecpay=result 模擬綠界回跳；REST 全部 stub，不打真實後端。
 */
import { test, expect } from '@playwright/test';
import { seedSession, installRoutes } from './helpers/supabase-mock';

const USER = { id: 'test-user-uuid', email: 'tester@example.com' };
const PLAN_ID = 'plan-1';
const EXPERT_SLUG = 'alice';
const EXPERT_ID = 'expert-1';

test.describe('Checkout 付款成功 → toast + 導回 /app', () => {
  test('ECPay 回跳：偵測到 active 訂閱後顯示 toast 並自動導回 /app', async ({ page }) => {
    await seedSession(page, USER);

    // 一開始 member_subscriptions 是空的；模擬成功扣款後 polling 第二次回傳 active row。
    let subscriptionCheckCount = 0;

    await installRoutes(page, {
      rest: {
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
        member_subscriptions: () => {
          subscriptionCheckCount += 1;
          // 第一次（useCheckoutData 檢查 alreadySubscribed）→ 空
          // 第二次起（useSubscriptionConfirmation 的 checkExisting / poll）→ 已 active
          if (subscriptionCheckCount <= 1) return [];
          return [{ id: 'sub-active-1' }];
        },
      },
      functions: {},
    });

    await page.goto(`/checkout/${EXPERT_SLUG}/${PLAN_ID}?ecpay=result`);

    // 自動 navigate('/app') — 等待 URL 改變
    await page.waitForURL((url) => url.pathname === '/app', { timeout: 15_000 });

    // sonner toast 顯示成功訊息
    await expect(page.getByText('訂閱成功，可在「我的服務」中看到。')).toBeVisible({ timeout: 5_000 });

    // 訂閱檢查至少被呼叫 2 次（initial fetch + confirmation poll）
    expect(subscriptionCheckCount).toBeGreaterThanOrEqual(2);
  });
});
