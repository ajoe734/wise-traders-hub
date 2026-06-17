/**
 * Checkout 付款逾時 → 重試付款 → 成功完成付款 → 導回 /app 並顯示 ACTIVE 訂閱。
 *
 * 流程：
 *   1. 訪問 /checkout/:slug/:planId?linepay=confirm... → confirm-linepay 回逾時 → 顯示「重試付款」
 *   2. 點擊「重試付款」→ URL 清掉 linepay query，回到乾淨 checkout 頁
 *   3. 模擬使用者重新付款成功：用 ?ecpay=result 重新進入，member_subscriptions polling 回傳 active
 *   4. 驗證：自動 navigate('/app') + sonner 成功 toast + /app 看得到 ACTIVE 訂閱
 */
import { test, expect } from '@playwright/test';
import { seedSession, installRoutes } from './helpers/supabase-mock';

const USER = { id: 'test-user-uuid', email: 'tester@example.com' };
const PLAN_ID = 'plan-1';
const EXPERT_SLUG = 'alice';
const EXPERT_ID = 'expert-1';

test.describe('Checkout 付款逾時後重試付款 → 成功 → ACTIVE', () => {
  test('逾時 → 重試付款 → 重新付款成功 → /app 顯示 ACTIVE 訂閱', async ({ page }) => {
    await seedSession(page, USER);

    // member_subscriptions 計次：
    //   #1 useCheckoutData 在 linepay 階段檢查 alreadySubscribed → 空
    //   #2 useCheckoutData 在第二段 ecpay 階段檢查 → 空
    //   #3+ useSubscriptionConfirmation poll / checkExisting → active
    //   後續 /app 與 SubscribedExpertsList 也會查 → active
    let subCount = 0;

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
          { id: 'prov-linepay', display_name: 'LINE Pay', provider_type: 'line_pay', is_active: true, is_default: true, env: 'sandbox' },
          { id: 'prov-ecpay', display_name: '綠界', provider_type: 'ecpay', is_active: true, is_default: false, env: 'sandbox' },
        ],
        experts: () => ({ id: EXPERT_ID, name: 'Alice', slug: EXPERT_SLUG, avatar_url: '', role: 'advisor' }),
        member_subscriptions: () => {
          subCount += 1;
          if (subCount <= 2) return [];
          // 重試付款後一切 query 回傳 active —— 包含 SubscribedExpertsList join
          return [
            {
              id: 'sub-active-1',
              plan_id: PLAN_ID,
              status: 'active',
              user_id: USER.id,
              expert_plans: {
                plan_type: 'analyst_signal_l1',
                expert_id: EXPERT_ID,
                experts: {
                  id: EXPERT_ID,
                  slug: EXPERT_SLUG,
                  name: 'Alice',
                  avatar_url: null,
                  role: 'advisor',
                  status: 'active',
                  line_oa_id: null,
                  line_channel_name: null,
                  qr_code_url: null,
                },
              },
            },
          ];
        },
        payment_intents: () => [],
      },
      functions: {
        // 第一輪 linepay confirm 模擬「付款逾時」失敗
        'confirm-linepay': () => ({ success: false, message: '付款逾時，請重新付款' }),
      },
    });

    // === Step 1: 進入 checkout，落入逾時失敗對話框 ===
    await page.goto(`/checkout/${EXPERT_SLUG}/${PLAN_ID}?linepay=confirm&transactionId=tx-timeout&orderId=ord-timeout`);
    await expect(page.getByText('訂閱失敗')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/付款.*失敗|付款逾時/)).toBeVisible();

    // === Step 2: 點擊「重試付款」→ URL 清掉 query ===
    const retryBtn = page.getByTestId('checkout-retry-button');
    await expect(retryBtn).toHaveText('重試付款');
    await retryBtn.click();
    await page.waitForURL(`**/checkout/${EXPERT_SLUG}/${PLAN_ID}`, { timeout: 5_000 });
    expect(new URL(page.url()).searchParams.get('linepay')).toBeNull();

    // === Step 3: 模擬使用者重新付款並從 ECPay 成功回跳 ===
    await page.goto(`/checkout/${EXPERT_SLUG}/${PLAN_ID}?ecpay=result`);

    // === Step 4: useSubscriptionConfirmation 偵測 active → 導回 /app + toast ===
    await page.waitForURL((url) => url.pathname === '/app', { timeout: 15_000 });
    await expect(page.getByText('訂閱成功，可在「我的服務」中看到。')).toBeVisible({ timeout: 5_000 });

    // === Step 5: 進入 /app/subscriptions 驗證該訂閱顯示為 ACTIVE ===
    await page.goto('/app/subscriptions');
    await expect(page.getByText(/方案 #/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('active').first()).toBeVisible();

    expect(subCount).toBeGreaterThanOrEqual(3);
  });
});
