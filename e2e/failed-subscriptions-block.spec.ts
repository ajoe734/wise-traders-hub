/**
 * 「失敗 / 未完成的訂閱」區塊（/app/subscriptions）
 *
 * 驗證：
 *   1. payment_intents.status='abandoned' 的項目會顯示在區塊裡（expert_plan + checkup 各一）
 *   2. 各項目的「重試付款」按鈕導向正確的 checkout 路由
 *      - expert_plan → /checkout/{slug}/{planId}?cycle={billing_cycle}
 *      - checkup     → /checkup/checkout?plan={checkup_plan_id}&cycle={billing_cycle}
 *   3. abandoned 訂閱不會被當成 ACTIVE（active 列為空）
 */
import { test, expect } from '@playwright/test';
import { seedSession, installRoutes } from './helpers/supabase-mock';

const USER = { id: 'test-user-uuid', email: 'tester@example.com' };

const ABANDONED_EXPERT_INTENT = {
  id: 'intent-1',
  trade_no: 'TRADE-1',
  product_kind: 'expert_plan',
  plan_id: 'plan-alpha',
  checkup_plan_id: null,
  expert_id: 'exp-1',
  amount: 599,
  billing_cycle: 'monthly',
  created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  expert_plans: { name: '訊號方案', experts: { name: 'Alice', slug: 'alice' } },
  checkup_plans: null,
};

const ABANDONED_CHECKUP_INTENT = {
  id: 'intent-2',
  trade_no: 'TRADE-2',
  product_kind: 'checkup',
  plan_id: null,
  checkup_plan_id: 'ckp-pro',
  expert_id: null,
  amount: 299,
  billing_cycle: 'yearly',
  created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  expert_plans: null,
  checkup_plans: { name: 'Pro 健檢' },
};

function installAbandonedRoutes(page: any) {
  return installRoutes(page, {
    rest: {
      // active 訂閱列為空 — 驗證 abandoned 不會被誤判為 ACTIVE
      member_subscriptions: () => [],
      // FailedIntentsCard 查詢來源
      payment_intents: () => [ABANDONED_EXPERT_INTENT, ABANDONED_CHECKUP_INTENT],
      // FailedIntentsCard 重試會 window.location.href 到 checkout，需要對應 stub 才不會 500
      expert_plans: () => ({
        id: 'plan-alpha', name: '訊號方案', plan_type: 'analyst_signal_l1',
        price_monthly: 599, price_yearly: 5990, description: '', features: [], expert_id: 'exp-1',
      }),
      payment_providers_safe: () => [
        { id: 'p1', display_name: '綠界', provider_type: 'ecpay', is_active: true, is_default: true, env: 'sandbox' },
      ],
      experts: () => ({ id: 'exp-1', name: 'Alice', slug: 'alice', avatar_url: '', role: 'advisor' }),
      checkup_plans: () => ({
        id: 'ckp-pro', name: 'Pro 健檢', price_monthly: 299, price_yearly: 2990,
      }),
    },
    functions: {},
  });
}

test.describe('/app/subscriptions — 失敗 / 未完成訂閱區塊', () => {
  test('顯示所有 abandoned payment_intents 並標示「付款失敗」', async ({ page }) => {
    await seedSession(page, USER);
    await installAbandonedRoutes(page);

    await page.goto('/app/subscriptions');

    // 區塊存在
    const block = page.getByTestId('failed-subscriptions-section');
    await expect(block).toBeVisible({ timeout: 10_000 });
    await expect(block.getByText('失敗 / 未完成的訂閱')).toBeVisible();

    // expert_plan 項目
    await expect(block.getByText(/Alice.*訊號方案/)).toBeVisible();
    // checkup 項目
    await expect(block.getByText(/健檢.*Pro 健檢/)).toBeVisible();

    // 兩個項目都有「付款失敗」badge
    await expect(block.getByText('付款失敗')).toHaveCount(2);

    // 兩個項目都有重試按鈕
    const retryButtons = block.getByTestId('failed-intent-retry');
    await expect(retryButtons).toHaveCount(2);

    // active 訂閱列為空 — 不該誤判 abandoned 為 ACTIVE（SubscribedExpertsList 不會出現「方案 #xxxxxxxx」卡片）
    await expect(page.getByText(/^方案 #/)).toHaveCount(0);
  });

  test('expert_plan abandoned → 重試付款導向 /checkout/{slug}/{planId}?cycle=monthly', async ({ page }) => {
    await seedSession(page, USER);
    await installAbandonedRoutes(page);

    await page.goto('/app/subscriptions');
    const block = page.getByTestId('failed-subscriptions-section');
    await expect(block).toBeVisible({ timeout: 10_000 });

    // 第一個（最新 created_at）= expert_plan
    await block.getByTestId('failed-intent-retry').first().click();
    await page.waitForURL((url) => url.pathname === '/checkout/alice/plan-alpha', { timeout: 5_000 });
    expect(new URL(page.url()).searchParams.get('cycle')).toBe('monthly');
  });

  test('checkup abandoned → 重試付款導向 /checkup/checkout?plan=...&cycle=yearly', async ({ page }) => {
    await seedSession(page, USER);
    await installAbandonedRoutes(page);

    await page.goto('/app/subscriptions');
    const block = page.getByTestId('failed-subscriptions-section');
    await expect(block).toBeVisible({ timeout: 10_000 });

    // 第二個 = checkup
    await block.getByTestId('failed-intent-retry').nth(1).click();
    await page.waitForURL((url) => url.pathname === '/checkout/checkup/ckp-pro', { timeout: 5_000 });
    const sp = new URL(page.url()).searchParams;
    expect(sp.get('cycle')).toBe('yearly');
  });
});
