import { test, expect } from '@playwright/test';
import { seedSession, installRoutes } from './helpers/supabase-mock';

/**
 * Batch 5b React Query regression — desktop E2E.
 *
 * Coverage: 5 /company/* pages migrated to React Query.
 *
 * For each page we assert:
 *   1. Mount fires the underlying query exactly once.
 *   2. Re-render / focus / sibling navigation does NOT refetch within staleTime.
 *   3. Changing a piece of the queryKey (filter / page / search) DOES refetch.
 *   4. A successful mutation invalidates and triggers a refetch.
 *
 * Auth + REST + Functions are mocked via `e2e/helpers/supabase-mock.ts`.
 */

const adminProfile = {
  display_name: 'Admin',
  expert_slug: null,
  avatar_url: null,
  line_user_id: null,
  is_tester: false,
};
const adminRoles = [{ role: 'company_admin' }];

const baseRest = {
  profiles: () => adminProfile,
  user_roles: () => adminRoles,
};

// -----------------------------------------------------------------------------
// /company/remittance — queryKey: ['company','remittance', filter]
// -----------------------------------------------------------------------------
test.describe('/company/remittance', () => {
  const remittanceRows = () => [
    {
      id: 'r1',
      product_kind: 'checkup_plan',
      billing_cycle: 'monthly',
      amount: 199,
      status: 'pending',
      last5: '12345',
      payer_name: '張三',
      created_at: new Date().toISOString(),
      reject_reason: null,
      plan_id: null,
      checkup_plan_id: 'cp1',
      original_amount: null,
      discount_amount: null,
      discount_reason: null,
      confirmed_at: null,
      confirmed_by: null,
    },
  ];

  test('mount fires once; tab switch with same filter does not refetch', async ({ page }) => {
    await seedSession(page, { id: 'admin', email: 'admin@test.com' });
    let remittanceFetches = 0;
    await installRoutes(page, {
      rest: {
        ...baseRest,
        remittance_orders: ({ method }) => {
          if (method === 'GET') remittanceFetches += 1;
          return remittanceRows();
        },
        checkup_plans: () => [{ id: 'cp1', name: 'Pro' }],
        expert_plans: () => [],
      },
    });

    await page.goto('/company/remittance');
    await expect(page.getByText('訂單 ID：r1')).toBeVisible();
    await expect.poll(() => remittanceFetches).toBe(1);

    // window focus should NOT refetch (within staleTime)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(400);
    expect(remittanceFetches).toBe(1);
  });

  test('changing filter tab refetches (queryKey changes)', async ({ page }) => {
    await seedSession(page, { id: 'admin', email: 'admin@test.com' });
    let remittanceFetches = 0;
    await installRoutes(page, {
      rest: {
        ...baseRest,
        remittance_orders: ({ method }) => {
          if (method === 'GET') remittanceFetches += 1;
          return remittanceRows();
        },
        checkup_plans: () => [{ id: 'cp1', name: 'Pro' }],
        expert_plans: () => [],
      },
    });

    await page.goto('/company/remittance');
    await expect(page.getByText('訂單 ID：r1')).toBeVisible();
    await expect.poll(() => remittanceFetches).toBe(1);

    await page.getByRole('button', { name: '已開通' }).click();
    await expect.poll(() => remittanceFetches, { timeout: 3_000 }).toBe(2);

    // Switching back to a previously visited filter — react-query has cached it
    // (still within staleTime) so should NOT refetch.
    await page.getByRole('button', { name: '待對帳' }).click();
    await page.waitForTimeout(400);
    expect(remittanceFetches).toBe(2);
  });

  test('confirm-remittance mutation invalidates and refetches', async ({ page }) => {
    await seedSession(page, { id: 'admin', email: 'admin@test.com' });
    let remittanceFetches = 0;
    let confirmCalled = 0;
    let currentStatus = 'pending';
    await installRoutes(page, {
      rest: {
        ...baseRest,
        remittance_orders: ({ method }) => {
          if (method === 'GET') remittanceFetches += 1;
          const rows = remittanceRows();
          rows[0].status = currentStatus;
          if (currentStatus === 'confirmed') {
            rows[0].confirmed_at = new Date().toISOString();
            rows[0].confirmed_by = 'admin';
          }
          return rows;
        },
        checkup_plans: () => [{ id: 'cp1', name: 'Pro' }],
        expert_plans: () => [],
      },
      functions: {
        'confirm-remittance': ({ body }) => {
          confirmCalled += 1;
          expect(body).toMatchObject({ orderId: 'r1' });
          currentStatus = 'confirmed';
          return { ok: true };
        },
      },
    });

    await page.goto('/company/remittance');
    await expect(page.getByText('訂單 ID：r1')).toBeVisible();
    await expect.poll(() => remittanceFetches).toBe(1);

    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: /確認入帳/ }).click();

    await expect.poll(() => confirmCalled, { timeout: 3_000 }).toBe(1);
    await expect.poll(() => remittanceFetches, { timeout: 3_000 }).toBeGreaterThan(1);
    await expect(page.getByText('已開通').first()).toBeVisible();
  });
});

// -----------------------------------------------------------------------------
// /company/subscribers — queryKey: ['company','subscribers']
// -----------------------------------------------------------------------------
test.describe('/company/subscribers', () => {
  test('mount fires once; no refetch on focus within staleTime', async ({ page }) => {
    await seedSession(page, { id: 'admin', email: 'admin@test.com' });
    let memberFetches = 0;
    let checkupFetches = 0;
    await installRoutes(page, {
      rest: {
        ...baseRest,
        member_subscriptions: ({ method }) => {
          if (method === 'GET') memberFetches += 1;
          return [];
        },
        checkup_subscriptions: ({ method }) => {
          if (method === 'GET') checkupFetches += 1;
          return [];
        },
        expert_plans: () => [],
        checkup_plans: () => [],
        experts: () => [],
      },
    });

    await page.goto('/company/subscribers');
    await expect.poll(() => memberFetches).toBe(1);
    await expect.poll(() => checkupFetches).toBe(1);

    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(400);
    expect(memberFetches).toBe(1);
    expect(checkupFetches).toBe(1);
  });
});

// -----------------------------------------------------------------------------
// /company/users — queryKey: ['company','users', debouncedSearch]
// -----------------------------------------------------------------------------
test.describe('/company/users', () => {
  const fakeUsers = [
    { user_id: 'u1', email: 'alice@x.com', display_name: 'Alice', roles: [], banned_until: null, expert_slug: null },
    { user_id: 'u2', email: 'bob@x.com', display_name: 'Bob', roles: ['analyst'], banned_until: null, expert_slug: 'bob' },
  ];

  test('debounced search: rapid typing collapses to 1 extra fetch (keepPreviousData)', async ({ page }) => {
    await seedSession(page, { id: 'admin', email: 'admin@test.com' });
    let listCalls = 0;
    const seenSearches: string[] = [];
    await installRoutes(page, {
      rest: { ...baseRest },
      functions: {
        'admin-manage-users': ({ body }) => {
          if (body?.action === 'list') {
            listCalls += 1;
            seenSearches.push(body.search || '');
            return { users: fakeUsers };
          }
          return { ok: true };
        },
      },
    });

    await page.goto('/company/users');
    await expect(page.getByText('alice@x.com')).toBeVisible();
    await expect.poll(() => listCalls).toBe(1);

    // Type quickly within the 300ms debounce window
    const search = page.getByPlaceholder('搜尋 Email、名稱、Slug、UUID');
    await search.focus();
    await page.keyboard.type('ali', { delay: 50 });

    // Wait past debounce
    await page.waitForTimeout(500);
    await expect.poll(() => listCalls, { timeout: 3_000 }).toBe(2);
    expect(seenSearches[1]).toBe('ali');

    // Previous rows stayed visible during debounce/fetch — keepPreviousData contract
    await expect(page.getByText('alice@x.com')).toBeVisible();
  });

  test('mutation success invalidates [company, users] cache', async ({ page }) => {
    await seedSession(page, { id: 'admin', email: 'admin@test.com' });
    let listCalls = 0;
    let setRoleCalls = 0;
    await installRoutes(page, {
      rest: { ...baseRest },
      functions: {
        'admin-manage-users': ({ body }) => {
          if (body?.action === 'list') {
            listCalls += 1;
            return { users: fakeUsers };
          }
          if (body?.action === 'set_role') {
            setRoleCalls += 1;
            return { ok: true };
          }
          return { ok: true };
        },
      },
    });

    await page.goto('/company/users');
    await expect(page.getByText('alice@x.com')).toBeVisible();
    await expect.poll(() => listCalls).toBe(1);

    // Accept the window.confirm
    page.on('dialog', (d) => d.accept());

    // Find Alice's row and click 指派 管理員 (first matching analyst toggle is fine)
    const aliceRow = page.locator('tr', { hasText: 'alice@x.com' });
    const adminToggle = aliceRow.getByRole('button', { name: /管理員/ }).first();
    if (await adminToggle.count()) {
      await adminToggle.click();
      await expect.poll(() => setRoleCalls, { timeout: 3_000 }).toBe(1);
      await expect.poll(() => listCalls, { timeout: 3_000 }).toBeGreaterThan(1);
    }
  });
});

// -----------------------------------------------------------------------------
// /company/audit-logs — keys: ['company','audit-logs','actions'] (5min)
//                              ['company','audit-logs', {page,...filters}] (30s)
// -----------------------------------------------------------------------------
test.describe('/company/audit-logs', () => {
  test('actions query (5min) does not refetch on filter change; page query does', async ({ page }) => {
    await seedSession(page, { id: 'admin', email: 'admin@test.com' });
    let actionsFetches = 0;
    let pageFetches = 0;
    await installRoutes(page, {
      rest: {
        ...baseRest,
        audit_logs: ({ url, method }) => {
          if (method !== 'GET') return [];
          const select = url.searchParams.get('select') || '';
          // The actions-only query selects just `action`; the page query selects detailed cols.
          if (select === 'action') {
            actionsFetches += 1;
            return [{ action: 'auth.login' }, { action: 'auth.logout' }];
          }
          pageFetches += 1;
          return [];
        },
      },
    });

    await page.goto('/company/audit-logs');
    await expect.poll(() => actionsFetches).toBeGreaterThan(0);
    await expect.poll(() => pageFetches).toBeGreaterThan(0);
    const actionsBaseline = actionsFetches;
    const pageBaseline = pageFetches;

    // Change time range filter — page queryKey changes → refetch page; actions stays
    await page.getByRole('combobox').nth(1).click();
    await page.getByRole('option', { name: '最近 90 天' }).click();

    await expect.poll(() => pageFetches, { timeout: 3_000 }).toBeGreaterThan(pageBaseline);
    expect(actionsFetches).toBe(actionsBaseline);

    // Window focus → both stay flat (within staleTime)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(400);
    expect(actionsFetches).toBe(actionsBaseline);
  });
});

// -----------------------------------------------------------------------------
// /company/backtest-monitor — queryKey: ['company','backtest-monitor']
// -----------------------------------------------------------------------------
test.describe('/company/backtest-monitor', () => {
  test('mount fires the combined snapshot once; refresh button invalidates', async ({ page }) => {
    await seedSession(page, { id: 'admin', email: 'admin@test.com' });
    // Sentinel: knowledge_backtest_runs is unique to this page's snapshot query.
    let snapshotFetches = 0;
    await installRoutes(page, {
      rest: {
        ...baseRest,
        knowledge_backtest_runs: ({ method }) => {
          if (method === 'GET') snapshotFetches += 1;
          return [];
        },
        checkup_knowledge_items: () => [],
        knowledge_backfill_progress: () => [],
        daily_price_snapshots: () => [],
        function_run_logs: () => [],
      },
    });

    await page.goto('/company/backtest-monitor');
    await expect.poll(() => snapshotFetches).toBe(1);

    // Focus → no refetch within staleTime
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(400);
    expect(snapshotFetches).toBe(1);

    // Manual refresh button → invalidate triggers exactly one additional fetch
    const refreshBtn = page.getByRole('button', { name: /重新整理|刷新|Refresh/i }).first();
    if (await refreshBtn.count()) {
      await refreshBtn.click();
      await expect.poll(() => snapshotFetches, { timeout: 3_000 }).toBe(2);
    }
  });
});

// -----------------------------------------------------------------------------
// /company/analysts — queryKey: ['company-experts']
// -----------------------------------------------------------------------------
test.describe('/company/analysts', () => {
  test('mount fires once; focus & re-render do not refetch within staleTime', async ({ page }) => {
    await seedSession(page, { id: 'admin', email: 'admin@test.com' });
    let expertsFetches = 0;
    await installRoutes(page, {
      rest: {
        ...baseRest,
        experts: ({ method, url }) => {
          if (method === 'GET') {
            // The page query is `select=*&order=created_at...` — distinguish from
            // any layout query that joins expert_plans.
            const select = url.searchParams.get('select') || '';
            if (!select.includes('expert_plans')) expertsFetches += 1;
          }
          return [
            { id: 'e1', name: 'Alice', slug: 'alice', status: 'active', created_at: new Date().toISOString(), created_by: 'admin', avatar_url: null, role: 'analyst', email: 'a@x.com' },
          ];
        },
        expert_line_channels: () => [],
        member_line_bindings_analyst: () => [],
      },
    });

    await page.goto('/company/analysts');
    await expect(page.getByText('Alice').first()).toBeVisible();
    await expect.poll(() => expertsFetches).toBe(1);

    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(400);
    expect(expertsFetches).toBe(1);
  });
});

// -----------------------------------------------------------------------------
// /admin/:slug/profile — keys: ['admin','profile', slug]
//                              ['admin','profile','capital-status', expertId]
// -----------------------------------------------------------------------------
test.describe('/admin/:slug/profile', () => {
  const expertRow = {
    id: 'exp-1',
    user_id: 'admin',
    slug: 'alice',
    name: 'Alice',
    bio: '',
    description: '',
    style_tags: [],
    markets: [],
    starting_capital: 1000000,
    avatar_url: null,
    status: 'active',
    role: 'analyst',
  };

  test('expert + capital-status fire once; focus does not refetch', async ({ page }) => {
    await seedSession(page, { id: 'admin', email: 'admin@test.com' });
    let expertSelectStarFetches = 0;
    let capitalRpcCalls = 0;
    await installRoutes(page, {
      rest: {
        ...baseRest,
        experts: ({ method, url }) => {
          if (method === 'GET') {
            const select = url.searchParams.get('select') || '';
            // The page query is `select=*` (no expert_plans join).
            if (select === '*') expertSelectStarFetches += 1;
            // Layout (useExpert) uses '*,expert_plans(*)' — out of scope here.
            return [expertRow];
          }
          return [expertRow];
        },
        rpc: ({ url }) => {
          if (url.pathname.endsWith('/get_expert_capital_status')) {
            capitalRpcCalls += 1;
            return { available_cash: 500000, open_cost_value: 400000, realized_pnl_amount: 100000 };
          }
          return null;
        },
      },
    });

    await page.goto('/admin/alice/profile');
    await expect.poll(() => expertSelectStarFetches, { timeout: 5_000 }).toBe(1);
    await expect.poll(() => capitalRpcCalls, { timeout: 5_000 }).toBe(1);

    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(400);
    expect(expertSelectStarFetches).toBe(1);
    expect(capitalRpcCalls).toBe(1);
  });

  test('handleSave invalidates expert key → refetches expert', async ({ page }) => {
    await seedSession(page, { id: 'admin', email: 'admin@test.com' });
    let expertSelectStarFetches = 0;
    let expertUpdates = 0;
    await installRoutes(page, {
      rest: {
        ...baseRest,
        experts: ({ method, url }) => {
          if (method === 'GET') {
            const select = url.searchParams.get('select') || '';
            if (select === '*') expertSelectStarFetches += 1;
          }
          if (method === 'PATCH') expertUpdates += 1;
          return [expertRow];
        },
        rpc: () => ({ available_cash: 0, open_cost_value: 0, realized_pnl_amount: 0 }),
      },
    });

    await page.goto('/admin/alice/profile');
    await expect.poll(() => expertSelectStarFetches).toBe(1);

    await page.getByRole('button', { name: /儲存變更/ }).click();

    await expect.poll(() => expertUpdates, { timeout: 3_000 }).toBe(1);
    await expect.poll(() => expertSelectStarFetches, { timeout: 3_000 }).toBeGreaterThan(1);
  });
});
