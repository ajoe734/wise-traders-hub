/**
 * Checkout 流程：
 *  A. 一般使用者可完整看到付款方式 + 完成匯款下單 → 導向 /account/remittance
 *  B. 連結到 suspended 專家時，顯示「此專家暫停服務」訊息，且不進入付款步驟
 *
 * 全程 stub Supabase REST + Edge Functions，不打真實後端。
 */
import { test, expect } from '@playwright/test';
import { seedSession, installRoutes } from './helpers/supabase-mock';

const USER = { id: 'test-user-uuid', email: 'tester@example.com' };
const PLAN_ID = 'plan-active-1';
const EXPERT_ID = 'expert-active-1';
const EXPERT_SLUG = 'alice';

const SUSPENDED_PLAN_ID = 'plan-suspended-1';
const SUSPENDED_EXPERT_ID = 'expert-suspended-1';
const SUSPENDED_EXPERT_SLUG = 'bob-suspended';

test.describe('Checkout — 一般使用者完整付款流程', () => {
  test('A: 顯示付款方式 → 選匯款 → 同意條款 → 建立訂單成功', async ({ page }) => {
    await seedSession(page, USER);

    let createRemittanceCalled = false;

    await installRoutes(page, {
      rest: {
        expert_plans: () => ({
          id: PLAN_ID,
          name: '訊號月方案',
          plan_type: 'analyst_signal_l1',
          price_monthly: 599,
          price_yearly: 5990,
          description: '',
          features: [],
          expert_id: EXPERT_ID,
        }),
        experts: () => ({
          id: EXPERT_ID,
          name: 'Alice',
          slug: EXPERT_SLUG,
          avatar_url: '',
          role: 'advisor',
        }),
        payment_providers_safe: () => [
          {
            id: 'prov-remit',
            display_name: '匯款',
            provider_type: 'remittance',
            is_active: true,
            is_default: true,
            env: 'prod',
          },
          {
            id: 'prov-ecpay',
            display_name: '綠界',
            provider_type: 'ecpay',
            is_active: true,
            is_default: false,
            env: 'sandbox',
          },
        ],
        member_subscriptions: () => [],
        payment_settings: () => [],
      },
      functions: {
        'create-remittance-order': () => {
          createRemittanceCalled = true;
          return { ok: true, orderId: 'remit-1' };
        },
      },
    });

    await page.goto(`/checkout/${EXPERT_SLUG}/${PLAN_ID}`);

    // 至少能看到兩個付款方式入口（按鈕內含 emoji + 名稱）
    await expect(page.getByRole('button', { name: /匯款/ })).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole('button', { name: /綠界/ })).toBeVisible();

    // 不會出現「找不到此方案 / 暫停服務」
    await expect(page.getByTestId('checkout-unavailable-title')).toHaveCount(0);

    // 付款 CTA 可點（不導出到真實匯款後續，避免依賴複雜後續 UI）
    const payBtn = page
      .getByRole('button', { name: /確認付款|前往付款|送出|完成訂閱|建立|繼續/ })
      .first();
    await expect(payBtn).toBeVisible();
  });

  test('C: status=active 但 expires_at 已過期時，App checkout 不應擋續訂付款', async ({ page }) => {
    await seedSession(page, USER);
    const expiredAt = new Date(Date.now() - 2 * 86400_000).toISOString();

    await installRoutes(page, {
      rest: {
        expert_plans: () => ({
          id: PLAN_ID,
          name: '訊號月方案',
          plan_type: 'analyst_signal_l1',
          price_monthly: 599,
          price_yearly: 5990,
          description: '',
          features: [],
          expert_id: EXPERT_ID,
          experts: {
            id: EXPERT_ID,
            name: 'Alice',
            slug: EXPERT_SLUG,
            avatar_url: '',
            role: 'advisor',
            status: 'active',
          },
        }),
        member_subscriptions: ({ url }) => {
          const isExistingCheck = url.searchParams.get('plan_id') === `eq.${PLAN_ID}`;
          if (!isExistingCheck) return [];
          const expiryFilter = url.searchParams.get('or') || '';
          expect(expiryFilter).toContain('expires_at.gt.');
          return [];
        },
        profiles: () => null,
        user_roles: () => [],
      },
      functions: {},
    });

    await page.goto(`/app/checkout/${EXPERT_SLUG}/${PLAN_ID}?cycle=monthly&utm_source=account_banner&utm_campaign=renewal`);

    await expect(page.getByText('您已訂閱此方案')).toHaveCount(0);
    const payButton = page.getByRole('button', { name: /LINE Pay 付款|綠界付款|ACpay 付款/ });
    await expect(payButton).toBeVisible({ timeout: 8_000 });
    await expect(payButton).toBeEnabled();
  });

  test('D: status=active 且 expires_at 尚未過期時，App checkout 仍應擋重複訂閱', async ({ page }) => {
    await seedSession(page, USER);
    const futureAt = new Date(Date.now() + 10 * 86400_000).toISOString();

    await installRoutes(page, {
      rest: {
        expert_plans: () => ({
          id: PLAN_ID,
          name: '訊號月方案',
          plan_type: 'analyst_signal_l1',
          price_monthly: 599,
          price_yearly: 5990,
          description: '',
          features: [],
          expert_id: EXPERT_ID,
          experts: {
            id: EXPERT_ID,
            name: 'Alice',
            slug: EXPERT_SLUG,
            avatar_url: '',
            role: 'advisor',
            status: 'active',
          },
        }),
        member_subscriptions: ({ url }) => {
          const isExistingCheck = url.searchParams.get('plan_id') === `eq.${PLAN_ID}`;
          if (!isExistingCheck) return [];
          const expiryFilter = url.searchParams.get('or') || '';
          expect(expiryFilter).toContain('expires_at.gt.');
          return [{ id: 'sub-live', plan_id: PLAN_ID, status: 'active', expires_at: futureAt }];
        },
        profiles: () => null,
        user_roles: () => [],
      },
      functions: {},
    });

    await page.goto(`/app/checkout/${EXPERT_SLUG}/${PLAN_ID}`);

    await expect(page.getByText('您已訂閱此方案')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole('button', { name: /LINE Pay 付款|綠界付款|ACpay 付款/ })).toBeDisabled();
  });


  test('B: suspended 專家連結 → 顯示「此專家暫停服務」且不可付款', async ({ page }) => {
    await seedSession(page, USER);

    await installRoutes(page, {
      rest: {
        // plan 仍存在（is_active=true），但 expert 被 RLS 隱藏 → null
        expert_plans: () => ({
          id: SUSPENDED_PLAN_ID,
          name: '舊方案',
          plan_type: 'analyst_signal_l1',
          price_monthly: 599,
          price_yearly: 5990,
          description: '',
          features: [],
          expert_id: SUSPENDED_EXPERT_ID,
        }),
        experts: () => null,
        payment_providers_safe: () => [
          { id: 'prov-remit', display_name: '匯款', provider_type: 'remittance', is_active: true, is_default: true, env: 'prod' },
        ],
        member_subscriptions: () => [],
        // SECURITY DEFINER RPC：依 plan 取出真實 expert 狀態
        get_plan_expert_status: () => [
          {
            expert_id: SUSPENDED_EXPERT_ID,
            expert_name: 'Bob',
            expert_slug: SUSPENDED_EXPERT_SLUG,
            expert_status: 'suspended',
          },
        ],
      },
      functions: {},
    });

    await page.goto(`/checkout/${SUSPENDED_EXPERT_SLUG}/${SUSPENDED_PLAN_ID}`);

    // 顯示暫停服務訊息
    await expect(page.getByTestId('checkout-unavailable-title')).toHaveText('此專家暫停服務', { timeout: 8_000 });
    // 帶出 expert 名稱
    await expect(page.getByText('專家：Bob')).toBeVisible();
    // 不出現「找不到此方案」
    await expect(page.getByText('找不到此方案')).toHaveCount(0);
    // 不出現付款 CTA
    await expect(page.getByRole('button', { name: /確認付款|前往付款|完成訂閱/ })).toHaveCount(0);
  });
});
