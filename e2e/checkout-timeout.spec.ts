/**
 * Checkout 付款逾時 → 不導回 /app，顯示「付款逾時」錯誤提示，
 * 並提供「重試付款」按鈕能回到乾淨的結帳頁。
 *
 * 走 LINE Pay confirm 路徑：edge function `confirm-linepay` 回 success:false +
 * message 含「付款逾時」（模擬 useSubscriptionConfirmation 60s 內未確認的等價場景）。
 */
import { test, expect } from '@playwright/test';
import { seedSession, installRoutes } from './helpers/supabase-mock';

const USER = { id: 'test-user-uuid', email: 'tester@example.com' };
const PLAN_ID = 'plan-1';
const EXPERT_SLUG = 'alice';
const EXPERT_ID = 'expert-1';

function baseRest() {
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
      { id: 'prov-linepay', display_name: 'LINE Pay', provider_type: 'line_pay', is_active: true, is_default: true, env: 'sandbox' },
    ],
    experts: () => ({ id: EXPERT_ID, name: 'Alice', slug: EXPERT_SLUG, avatar_url: '', role: 'advisor' }),
    member_subscriptions: () => [],
  };
}

test.describe('Checkout 付款逾時', () => {
  test('LINE Pay confirm 回「付款逾時」→ 不導回 /app、顯示錯誤、提供「重試付款」按鈕', async ({ page }) => {
    await seedSession(page, USER);
    await installRoutes(page, {
      rest: baseRest(),
      functions: {
        'confirm-linepay': () => ({ success: false, message: '付款逾時，請重新付款' }),
      },
    });

    const target = `/checkout/${EXPERT_SLUG}/${PLAN_ID}?linepay=confirm&transactionId=tx-timeout&orderId=ord-timeout`;
    await page.goto(target);

    // 錯誤訊息出現
    await expect(page.getByText('訂閱失敗')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/付款.*失敗|付款逾時/)).toBeVisible();

    // 未顯示成功 toast、URL 維持在 /checkout
    await expect(page.getByText('訂閱成功，可在「我的服務」中看到。')).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe(`/checkout/${EXPERT_SLUG}/${PLAN_ID}`);

    // 「重試付款」按鈕存在
    const retryBtn = page.getByTestId('checkout-retry-button');
    await expect(retryBtn).toBeVisible();
    await expect(retryBtn).toHaveText('重試付款');

    // 點擊後 URL 清掉 return query、留在 checkout（讓使用者重新選擇付款方式）
    await retryBtn.click();
    await page.waitForURL(`**/checkout/${EXPERT_SLUG}/${PLAN_ID}`, { timeout: 5_000 });
    const url = new URL(page.url());
    expect(url.pathname).toBe(`/checkout/${EXPERT_SLUG}/${PLAN_ID}`);
    expect(url.searchParams.get('linepay')).toBeNull();
    expect(url.searchParams.get('transactionId')).toBeNull();
  });
});
