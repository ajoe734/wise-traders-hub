/**
 * FailedIntentsCard status 過濾與 active plan 排除規則 — 黑盒驗證。
 *
 * 規則：
 *   1. payment_intents.status 為 'abandoned' 以外的值（pending/failed/completed/expired）一律不顯示。
 *      query 已 `.eq('status','abandoned')`；前端再做防禦過濾。
 *   2. 即使 status='abandoned'，若 plan_id 已在 ACTIVE 訂閱中 → 排除（避免「成功了還顯示失敗」）。
 *   3. pending 由 PendingCheckoutCard 處理，不該在「失敗 / 未完成的訂閱」區塊出現。
 */
import { test, expect } from '@playwright/test';
import { seedSession, installRoutes } from './helpers/supabase-mock';

const USER = { id: 'test-user-uuid', email: 'tester@example.com' };

function intent(id: string, status: string, planId: string, name: string) {
  return {
    id, status, trade_no: `TRADE-${id}`,
    product_kind: 'expert_plan',
    plan_id: planId,
    checkup_plan_id: null,
    expert_id: 'exp-1',
    amount: 599,
    billing_cycle: 'monthly',
    created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    expert_plans: { name, experts: { name: 'Alice', slug: 'alice' } },
    checkup_plans: null,
  };
}

test.describe('FailedIntentsCard status 過濾', () => {
  test('混合 status 時，前端嚴格只顯示 abandoned（pending/failed/completed/expired 全部不出現）', async ({ page }) => {
    await seedSession(page, USER);

    // 模擬若後端 query 異常或被 cache 污染，回傳混合 status。
    // 即便如此前端必須只渲染 abandoned 那筆。
    const mixed = [
      intent('i-pending', 'pending', 'plan-1', '訊號方案 1'),
      intent('i-failed', 'failed', 'plan-2', '訊號方案 2'),
      intent('i-completed', 'completed', 'plan-3', '訊號方案 3'),
      intent('i-expired', 'expired', 'plan-4', '訊號方案 4'),
      intent('i-abandoned', 'abandoned', 'plan-5', '訊號方案 5'),
    ];

    await installRoutes(page, {
      rest: {
        member_subscriptions: () => [],
        payment_intents: () => mixed,
      },
      functions: {},
    });

    await page.goto('/app/subscriptions');
    const block = page.getByTestId('failed-subscriptions-section');
    await expect(block).toBeVisible({ timeout: 10_000 });

    // 只有 1 筆「重試付款」按鈕（abandoned 那筆）
    await expect(block.getByTestId('failed-intent-retry')).toHaveCount(1);
    // 標題數量徽章 = 1
    await expect(block.locator('text=失敗 / 未完成的訂閱').locator('..').getByText('1')).toBeVisible();
    // 只有 plan-5 的方案名稱出現；其他四個不出現
    await expect(block.getByText(/訊號方案 5/)).toBeVisible();
    for (const n of ['訊號方案 1', '訊號方案 2', '訊號方案 3', '訊號方案 4']) {
      await expect(block.getByText(new RegExp(n))).toHaveCount(0);
    }
  });

  test('payment_intents 全部不是 abandoned → 失敗區塊整體不渲染', async ({ page }) => {
    await seedSession(page, USER);

    await installRoutes(page, {
      rest: {
        member_subscriptions: () => [],
        payment_intents: () => [
          intent('i-p', 'pending', 'plan-1', '訊號方案 P'),
          intent('i-f', 'failed', 'plan-2', '訊號方案 F'),
          intent('i-c', 'completed', 'plan-3', '訊號方案 C'),
        ],
      },
      functions: {},
    });

    await page.goto('/app/subscriptions');
    // 給 useEffect + render 一點時間
    await page.waitForTimeout(1_500);
    await expect(page.getByTestId('failed-subscriptions-section')).toHaveCount(0);
  });

  test('abandoned 但同 plan_id 已有 ACTIVE 訂閱 → 該筆被剔除，僅顯示其他 abandoned', async ({ page }) => {
    await seedSession(page, USER);

    await installRoutes(page, {
      rest: {
        // 已有 active subscription 對應 plan-A
        member_subscriptions: () => [
          {
            id: 'sub-1', plan_id: 'plan-A', status: 'active', user_id: USER.id,
            expert_plans: {
              plan_type: 'analyst_signal_l1', expert_id: 'exp-1',
              experts: {
                id: 'exp-1', slug: 'alice', name: 'Alice', avatar_url: null,
                role: 'advisor', status: 'active',
                line_oa_id: null, line_channel_name: null, qr_code_url: null,
              },
            },
          },
        ],
        // 兩筆 abandoned：一筆 plan-A（已 active 應剔除）、一筆 plan-B（應顯示）
        payment_intents: () => [
          intent('ia', 'abandoned', 'plan-A', '訊號方案 A'),
          intent('ib', 'abandoned', 'plan-B', '訊號方案 B'),
        ],
      },
      functions: {},
    });

    await page.goto('/app/subscriptions');
    const block = page.getByTestId('failed-subscriptions-section');
    await expect(block).toBeVisible({ timeout: 10_000 });

    // 只剩 plan-B 那筆
    await expect(block.getByTestId('failed-intent-retry')).toHaveCount(1);
    await expect(block.getByText(/訊號方案 B/)).toBeVisible();
    await expect(block.getByText(/訊號方案 A/)).toHaveCount(0);
  });
});
