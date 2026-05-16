import { test, expect } from '@playwright/test';
import { seedSession, installRoutes } from './helpers/supabase-mock';

/**
 * Batch 3 React Query regression — desktop E2E.
 *
 * Auth + REST + Functions are mocked via route interception so these specs
 * don't depend on real Supabase data. The mocks live in
 * `e2e/helpers/supabase-mock.ts`.
 */

test.describe('/account/remittance-orders', () => {
  test('logged-out: does NOT query remittance_orders', async ({ page }) => {
    let remittanceCalled = false;
    await installRoutes(page, {
      onRest: (table) => {
        if (table === 'remittance_orders') remittanceCalled = true;
      },
    });

    await page.goto('/account/remittance-orders');
    // Allow auth context to settle / redirect
    await page.waitForLoadState('networkidle');

    expect(remittanceCalled).toBe(false);
  });

  test('logged-in: shows spinner then renders orders', async ({ page }) => {
    await seedSession(page, { id: 'user-1', email: 'u1@test.com' });

    let resolveOrders!: (rows: any[]) => void;
    const ordersPromise = new Promise<any[]>((res) => { resolveOrders = res; });

    await installRoutes(page, {
      rest: {
        profiles: () => ({ display_name: 'Tester', expert_slug: null, avatar_url: null, line_user_id: null, is_tester: false }),
        user_roles: () => [],
        remittance_orders: () => ordersPromise,
      },
    });

    await page.goto('/account/remittance-orders');
    // Spinner visible while orders endpoint is pending
    await expect(page.locator('.animate-spin').first()).toBeVisible();

    resolveOrders([
      {
        id: 'order-a',
        product_kind: 'checkup_plan',
        billing_cycle: 'monthly',
        amount: 199,
        status: 'awaiting_info',
        last5: null,
        payer_name: null,
        created_at: new Date().toISOString(),
        reject_reason: null,
      },
    ]);

    await expect(page.getByText('待補匯款資料')).toBeVisible();
    await expect(page.getByLabel('匯款人姓名')).toBeVisible();
  });

  test('submit remittance info triggers refetch (invalidateQueries)', async ({ page }) => {
    await seedSession(page, { id: 'user-1', email: 'u1@test.com' });

    let remittanceFetches = 0;
    let submitCalled = false;
    let currentStatus = 'awaiting_info';

    await installRoutes(page, {
      rest: {
        profiles: () => ({ display_name: 'Tester', expert_slug: null, avatar_url: null, line_user_id: null, is_tester: false }),
        user_roles: () => [],
        remittance_orders: () => {
          remittanceFetches += 1;
          return [{
            id: 'order-a',
            product_kind: 'checkup_plan',
            billing_cycle: 'monthly',
            amount: 199,
            status: currentStatus,
            last5: submitCalled ? '12345' : null,
            payer_name: submitCalled ? '張三' : null,
            created_at: new Date().toISOString(),
            reject_reason: null,
          }];
        },
      },
      functions: {
        'submit-remittance-info': ({ body }) => {
          submitCalled = true;
          currentStatus = 'pending';
          expect(body).toMatchObject({ orderId: 'order-a', last5: '12345', payerName: '張三' });
          return { ok: true };
        },
      },
    });

    await page.goto('/account/remittance-orders');
    await expect(page.getByLabel('匯款人姓名')).toBeVisible();
    const initialFetches = remittanceFetches;

    await page.getByLabel('匯款人姓名').fill('張三');
    await page.getByLabel('轉出帳號末五碼').fill('12345');
    await page.getByRole('button', { name: '送出對帳資料' }).click();

    // After mutation: invalidateQueries → status changes from awaiting_info → pending
    await expect(page.getByText('待對帳')).toBeVisible();
    expect(submitCalled).toBe(true);
    expect(remittanceFetches).toBeGreaterThan(initialFetches);
  });
});

test.describe('/company/analysts', () => {
  const profile = { display_name: 'Admin', expert_slug: null, avatar_url: null, line_user_id: null, is_tester: false };
  const adminRoles = [{ role: 'company_admin' }];
  const baseExperts = [
    { id: 'e1', name: '張三', slug: 'zhang', role: 'advisor', status: 'active', avatar_url: '', created_by: 'admin', user_id: 'u1' },
    { id: 'e2', name: '李四', slug: 'li', role: 'mentor', status: 'suspended', avatar_url: '', created_by: null, user_id: 'u2' },
  ];

  test('logged-in admin: shows experts list', async ({ page }) => {
    await seedSession(page, { id: 'admin', email: 'admin@test.com' });
    await installRoutes(page, {
      rest: {
        profiles: () => profile,
        user_roles: () => adminRoles,
        experts: () => baseExperts,
      },
    });

    await page.goto('/company/analysts');
    await expect(page.getByText('張三')).toBeVisible();
    await expect(page.getByText('李四')).toBeVisible();
  });

  test('toggleStatus updates badge optimistically before PATCH resolves', async ({ page }) => {
    await seedSession(page, { id: 'admin', email: 'admin@test.com' });
    let patchCalled = false;
    let resolvePatch!: () => void;
    const patchPromise = new Promise<void>((res) => { resolvePatch = res; });

    await installRoutes(page, {
      rest: {
        profiles: () => profile,
        user_roles: () => adminRoles,
        experts: ({ method }) => {
          if (method === 'PATCH') {
            patchCalled = true;
            return patchPromise.then(() => []);
          }
          return baseExperts;
        },
        // audit log writes — accept anything
        admin_audit_logs: () => ({ id: 'audit-1' }),
      },
    });

    await page.goto('/company/analysts');
    const row = page.locator('tr', { hasText: '張三' });
    await expect(row).toBeVisible();
    await expect(row.getByText('啟用中')).toBeVisible();

    await row.getByRole('button', { name: '停用' }).click();

    // Optimistic: badge flips to 已停用 BEFORE the PATCH resolves
    await expect(row.getByText('已停用')).toBeVisible({ timeout: 2_000 });
    expect(patchCalled).toBe(true);

    // Clean up the pending promise so the test runner can exit
    resolvePatch();
  });
});
