/**
 * 重試付款成功 → reload /app/subscriptions →
 *   1. 訂閱清單只顯示 ACTIVE
 *   2. 「失敗 / 未完成的訂閱」區塊不再列出該筆 abandoned
 *
 * 涵蓋兩種「失敗區塊消失」的情境：
 *   A. 後端已把 payment_intents 標為 completed → query 拿不到 abandoned
 *   B. 後端 race / 尚未標記 → query 仍回 abandoned，但前端 active plan_id 過濾把它剔除
 */
import { test, expect } from '@playwright/test';
import { seedSession, installRoutes } from './helpers/supabase-mock';

const USER = { id: 'test-user-uuid', email: 'tester@example.com' };
const PLAN_ID = 'plan-alpha';
const EXPERT_SLUG = 'alice';
const EXPERT_ID = 'exp-1';

const ABANDONED_INTENT = {
  id: 'intent-1',
  status: 'abandoned',
  trade_no: 'TRADE-1',
  product_kind: 'expert_plan',
  plan_id: PLAN_ID,
  checkup_plan_id: null,
  expert_id: EXPERT_ID,
  amount: 599,
  billing_cycle: 'monthly',
  created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  expert_plans: { name: '訊號方案', experts: { name: 'Alice', slug: EXPERT_SLUG } },
  checkup_plans: null,
};

const ACTIVE_SUB_ROW = {
  id: 'sub-active-1',
  plan_id: PLAN_ID,
  status: 'active',
  user_id: USER.id,
  expert_plans: {
    plan_type: 'analyst_signal_l1',
    expert_id: EXPERT_ID,
    experts: {
      id: EXPERT_ID, slug: EXPERT_SLUG, name: 'Alice', avatar_url: null,
      role: 'advisor', status: 'active',
      line_oa_id: null, line_channel_name: null, qr_code_url: null,
    },
  },
};

test.describe('重試成功後 reload /app/subscriptions — abandoned 不再誤導', () => {
  test('A. 後端已標 completed：abandoned query 回空 → 失敗區塊消失，僅顯示 ACTIVE', async ({ page }) => {
    await seedSession(page, USER);

    let phase: 'before' | 'after' = 'before';
    await installRoutes(page, {
      rest: {
        member_subscriptions: () => phase === 'before' ? [] : [ACTIVE_SUB_ROW],
        // 後端 ecpay-callback 把 status 從 'abandoned' → 'completed'，所以重整後 query 自然空。
        payment_intents: () => phase === 'before' ? [ABANDONED_INTENT] : [],
      },
      functions: {},
    });

    // 第一次：失敗區塊出現
    await page.goto('/app/subscriptions');
    await expect(page.getByTestId('failed-subscriptions-section')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/^方案 #/)).toHaveCount(0);

    // 切換到「重試後」狀態 → reload
    phase = 'after';
    await page.reload();

    // ACTIVE 出現
    await expect(page.getByText(/方案 #/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('active').first()).toBeVisible();
    // 失敗區塊不出現
    await expect(page.getByTestId('failed-subscriptions-section')).toHaveCount(0);
  });

  test('B. 後端 race 未標 completed：abandoned 仍回，但前端被 active plan 過濾剔除', async ({ page }) => {
    await seedSession(page, USER);

    let phase: 'before' | 'after' = 'before';
    await installRoutes(page, {
      rest: {
        member_subscriptions: () => phase === 'before' ? [] : [ACTIVE_SUB_ROW],
        // 即使後端來不及標 completed，仍回 abandoned 一筆（且 plan_id 與 ACTIVE 訂閱相同）
        payment_intents: () => [ABANDONED_INTENT],
      },
      functions: {},
    });

    // 第一次：失敗區塊應出現（active 還沒上線）
    await page.goto('/app/subscriptions');
    await expect(page.getByTestId('failed-subscriptions-section')).toBeVisible({ timeout: 10_000 });

    // reload 切到 after
    phase = 'after';
    await page.reload();

    // ACTIVE 顯示
    await expect(page.getByText(/方案 #/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('active').first()).toBeVisible();

    // 即使 payment_intents 還有那筆 abandoned，前端 active plan_id 過濾 → 區塊消失
    await expect(page.getByTestId('failed-subscriptions-section')).toHaveCount(0);
  });
});
