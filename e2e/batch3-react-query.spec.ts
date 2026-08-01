import { test, expect } from '@playwright/test';
import { seedSession, installRoutes } from './helpers/supabase-mock';

/**
 * Batch 3 React Query regression — desktop E2E.
 *
 * Auth + REST + Functions are mocked via route interception so these specs
 * don't depend on real Supabase data. The mocks live in
 * `e2e/helpers/supabase-mock.ts`.
 */

test.describe('/account/remittance', () => {
  test('logged-out: does NOT query remittance_orders', async ({ page }) => {
    let remittanceCalled = false;
    await installRoutes(page, {
      onRest: (table) => {
        if (table === 'remittance_orders') remittanceCalled = true;
      },
    });

    await page.goto('/account/remittance');
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

    await page.goto('/account/remittance');
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

    await expect(page.getByTestId('remittance-status-badge')).toHaveText('待補匯款資料');
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

    await page.goto('/account/remittance');
    await expect(page.getByLabel('匯款人姓名')).toBeVisible();
    const initialFetches = remittanceFetches;

    await page.getByLabel('匯款人姓名').fill('張三');
    await page.getByLabel('轉出帳號末五碼').fill('12345');
    await page.getByRole('button', { name: '送出對帳資料' }).click();

    // After mutation: invalidateQueries → status changes from awaiting_info → pending
    await expect(page.getByTestId('remittance-status-badge')).toHaveText('待對帳');
    expect(submitCalled).toBe(true);
    expect(remittanceFetches).toBeGreaterThan(initialFetches);
  });

  test('submit failure: shows toast, keeps form values, does NOT refetch', async ({ page }) => {
    await seedSession(page, { id: 'user-1', email: 'u1@test.com' });

    let remittanceFetches = 0;
    let submitCalls = 0;

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
            status: 'awaiting_info',
            last5: null,
            payer_name: null,
            created_at: new Date().toISOString(),
            reject_reason: null,
          }];
        },
      },
      functions: {
        'submit-remittance-info': () => {
          submitCalls += 1;
          return { __status: 500, body: { error: '伺服器忙線中' } };
        },
      },
    });

    await page.goto('/account/remittance');
    await expect(page.getByLabel('匯款人姓名')).toBeVisible();
    const fetchesBeforeSubmit = remittanceFetches;

    await page.getByLabel('匯款人姓名').fill('張三');
    await page.getByLabel('轉出帳號末五碼').fill('12345');
    const submitBtn = page.getByRole('button', { name: '送出對帳資料' });
    await submitBtn.click();

    // Error toast surfaces (matches both the visible toast and the aria-live announcement)
    await expect(page.getByText('送出失敗').first()).toBeVisible();

    // Form fields are preserved so user can retry without re-typing
    await expect(page.getByLabel('匯款人姓名')).toHaveValue('張三');
    await expect(page.getByLabel('轉出帳號末五碼')).toHaveValue('12345');

    // Submit button no longer in loading state (submitting flag reset)
    await expect(submitBtn).toBeEnabled();

    // No refetch happened — status still 待補匯款資料
    await expect(page.getByTestId('remittance-status-badge')).toHaveText('待補匯款資料');
    expect(submitCalls).toBe(1);
    expect(remittanceFetches).toBe(fetchesBeforeSubmit);
  });
});

test.describe('/company/analysts create-analyst failure', () => {
  const profile = { display_name: 'Admin', expert_slug: null, avatar_url: null, line_user_id: null, is_tester: false };
  const adminRoles = [{ role: 'company_admin' }];

  test('create failure: toast, keeps form values, dialog open, no experts refetch', async ({ page }) => {
    await seedSession(page, { id: 'admin', email: 'admin@test.com' });

    // Pre-seed dialog state + form via sessionStorage so we don't need to interact
    // with the Radix Select (which is flaky under headless test).
    await page.addInitScript(() => {
      sessionStorage.setItem('company_analyst_create_open', 'true');
      sessionStorage.setItem('ca_email', 'new@analyst.com');
      sessionStorage.setItem('ca_password', 'P@ssw0rd!');
      sessionStorage.setItem('ca_name', '王五');
      sessionStorage.setItem('ca_slug', 'wang-wu');
      sessionStorage.setItem('ca_role', 'advisor');
    });

    let expertsFetches = 0;
    let createCalls = 0;

    await installRoutes(page, {
      rest: {
        profiles: () => profile,
        user_roles: () => adminRoles,
        experts: () => {
          expertsFetches += 1;
          return [
            { id: 'e1', name: '張三', slug: 'zhang', role: 'advisor', status: 'active', avatar_url: '', created_by: 'admin', user_id: 'u1' },
          ];
        },
      },
      functions: {
        'create-analyst': ({ body }) => {
          createCalls += 1;
          expect(body).toMatchObject({ email: 'new@analyst.com', name: '王五', slug: 'wang-wu', role: 'advisor' });
          return { __status: 400, body: { error: 'slug 已存在' } };
        },
      },
    });

    await page.goto('/company/analysts');
    // Dialog is restored open with prefilled fields
    const emailInput = page.locator('input[type="email"]');
    await expect(emailInput).toHaveValue('new@analyst.com');
    // Wait for the initial experts query to settle so we have a stable baseline
    await expect.poll(() => expertsFetches, { timeout: 5_000 }).toBeGreaterThan(0);
    await expect(page.getByText('張三')).toBeVisible();
    const fetchesBeforeCreate = expertsFetches;

    await page.getByRole('button', { name: '建立帳號' }).click();

    // Dialog stays open after failure (clearForm + setIsCreateOpen(false) NOT called)
    await expect(page.getByText('新增分析師帳號')).toBeVisible();

    // Wait briefly for setCreating(false) to flush
    await page.waitForTimeout(200);

    // Form values preserved for retry
    await expect(emailInput).toHaveValue('new@analyst.com');
    await expect(page.locator('input[type="password"]')).toHaveValue('P@ssw0rd!');
    await expect(page.getByRole('button', { name: '建立帳號' })).toBeEnabled();

    // No experts cache invalidation on failure
    expect(createCalls).toBe(1);
    expect(expertsFetches).toBe(fetchesBeforeCreate);
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

/**
 * staleTime cache assertions
 *
 * Both `remittance_orders` and `experts` queries use `staleTime: 30_000`.
 * SPA-navigating away and back should serve the cached data WITHOUT
 * re-hitting the network within that window. We assert the network counter
 * stays flat across the round-trip.
 */
test.describe('staleTime: no duplicate network calls within 30s', () => {
  test('/account/remittance fires remittance_orders once on mount, no polling', async ({ page }) => {
    await seedSession(page, { id: 'user-1', email: 'u1@test.com' });

    let remittanceFetches = 0;
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
            status: 'awaiting_info',
            last5: null,
            payer_name: null,
            created_at: new Date().toISOString(),
            reject_reason: null,
          }];
        },
      },
    });

    await page.goto('/account/remittance');
    await expect(page.getByLabel('匯款人姓名')).toBeVisible();
    await expect.poll(() => remittanceFetches).toBe(1);

    // Wait well past the React Query default refetchInterval (none configured)
    // and any auth-flicker refetch window. staleTime=30s means no background poll.
    await page.waitForTimeout(2_000);
    expect(remittanceFetches).toBe(1);

    // Simulate a window-focus event — refetchOnWindowFocus should be a no-op
    // because data is still within staleTime.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(500);
    expect(remittanceFetches).toBe(1);
  });

  test('/company/analysts does NOT refetch experts on SPA re-mount', async ({ page }) => {
    await seedSession(page, { id: 'admin', email: 'admin@test.com' });

    let expertsGetFetches = 0;
    await installRoutes(page, {
      rest: {
        profiles: () => ({ display_name: 'Admin', expert_slug: null, avatar_url: null, line_user_id: null, is_tester: false }),
        user_roles: () => [{ role: 'company_admin' }],
        experts: ({ method }) => {
          if (method === 'GET') expertsGetFetches += 1;
          return [
            { id: 'e1', name: '張三', slug: 'zhang', role: 'advisor', status: 'active', avatar_url: '', created_by: 'admin', user_id: 'u1' },
          ];
        },
      },
    });

    await page.goto('/company/analysts');
    await expect(page.getByText('張三')).toBeVisible();
    await expect.poll(() => expertsGetFetches).toBeGreaterThan(0);
    const baseline = expertsGetFetches;

    // SPA navigate to a sibling /company/* route via sidebar
    await page.getByRole('link', { name: '註冊帳號' }).first().click();
    await page.waitForURL('**/company/users');

    // SPA navigate back
    await page.getByRole('link', { name: '分析師管理' }).first().click();
    await page.waitForURL('**/company/analysts');
    await expect(page.getByText('張三')).toBeVisible();

    await page.waitForTimeout(500);

    // staleTime kept the experts cache fresh — no new GET should have fired
    expect(expertsGetFetches).toBe(baseline);
  });
});
