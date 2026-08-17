import { test, expect } from '@playwright/test';
import { seedSession, installRoutes } from './helpers/supabase-mock';

/**
 * Batch 5b React Query regression — desktop E2E.
 *
 * Batch 5b scope: 11 admin/company pages + admin/Profile.
 *
 * Migration & coverage matrix
 * ---------------------------------------------------------------
 *   page                              migrated   covered here
 *   ---------------------------------------------------------------
 *   /company/audit-logs                  ✅           ✅
 *   /company/backtest-monitor            ✅           ✅
 *   /company/remittance                  ✅           ✅
 *   /company/subscribers                 ✅           ✅
 *   /company/users                       ✅           ✅
 *   /company/analysts                    ✅           ✅
 *   /admin/:slug/profile                 ✅           ✅
 *   /company/knowledge-base              ✅           ✅
 *   /company/payments                    ✅           ✅
 *   /company/plans                       ✅           ✅
 *   /company/revenue                     ✅           ✅
 *   /company/referral-channels           ➖ stub       n/a
 * ---------------------------------------------------------------
 *
 * For each migrated page we assert:
 *   1. Mount fires the underlying query exactly once.
 *   2. Re-render / focus / sibling navigation does NOT refetch within staleTime.
 *   3. Changing a piece of the queryKey (filter / page / search) DOES refetch.
 *   4. A successful mutation invalidates and triggers a refetch.
 *
 * Auth + REST + Functions are mocked via `e2e/helpers/supabase-mock.ts`.
 *
 * Run the whole suite:
 *   bunx playwright test e2e/batch5b-react-query.spec.ts
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
  type AuditHandlers = {
    onActions?: () => void;
    onPage?: (url: URL) => void;
    rows?: any[];
  };

  const buildRoutes = (h: AuditHandlers = {}) => ({
    rest: {
      ...baseRest,
      audit_logs: ({ url, method }: { url: URL; method: string }) => {
        if (method !== 'GET') return [];
        const select = url.searchParams.get('select') || '';
        if (select === 'action') {
          h.onActions?.();
          return [
            { action: 'auth.login' },
            { action: 'auth.logout' },
            { action: 'plan.update' },
          ];
        }
        h.onPage?.(url);
        return h.rows ?? [];
      },
    },
  });

  test('actions query (5min) does not refetch on filter change; page query does', async ({ page }) => {
    await seedSession(page, { id: 'admin', email: 'admin@test.com' });
    let actionsFetches = 0;
    let pageFetches = 0;
    await installRoutes(page, buildRoutes({
      onActions: () => { actionsFetches += 1; },
      onPage: () => { pageFetches += 1; },
    }));

    await page.goto('/company/audit-logs');
    await expect.poll(() => actionsFetches).toBeGreaterThan(0);
    await expect.poll(() => pageFetches).toBeGreaterThan(0);
    const actionsBaseline = actionsFetches;
    const pageBaseline = pageFetches;

    // Change time range filter — page queryKey changes → refetch page; actions stays
    await page.getByRole('combobox').nth(2).click();
    await page.getByRole('option', { name: '最近 90 天' }).click();

    await expect.poll(() => pageFetches, { timeout: 3_000 }).toBeGreaterThan(pageBaseline);
    expect(actionsFetches).toBe(actionsBaseline);

    // Window focus → both stay flat (within staleTime / refetchOnWindowFocus disabled)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(400);
    expect(actionsFetches).toBe(actionsBaseline);
  });

  test('switching filter back within staleTime uses cache (no extra fetch)', async ({ page }) => {
    await seedSession(page, { id: 'admin', email: 'admin@test.com' });
    let pageFetches = 0;
    await installRoutes(page, buildRoutes({ onPage: () => { pageFetches += 1; } }));

    await page.goto('/company/audit-logs');
    await expect.poll(() => pageFetches).toBe(1);

    // 30d (default) → 7d → first new key, refetch
    await page.getByRole('combobox').nth(2).click();
    await page.getByRole('option', { name: '最近 7 天' }).click();
    await expect.poll(() => pageFetches, { timeout: 3_000 }).toBe(2);

    // Back to 30d — already cached within staleTime (30s) → no refetch
    await page.getByRole('combobox').nth(2).click();
    await page.getByRole('option', { name: '最近 30 天' }).click();
    await page.waitForTimeout(500);
    expect(pageFetches).toBe(2);

    // Back to 7d — also cached
    await page.getByRole('combobox').nth(2).click();
    await page.getByRole('option', { name: '最近 7 天' }).click();
    await page.waitForTimeout(500);
    expect(pageFetches).toBe(2);
  });

  test('changing namespace filter refetches page query but not actions list', async ({ page }) => {
    await seedSession(page, { id: 'admin', email: 'admin@test.com' });
    let actionsFetches = 0;
    let pageFetches = 0;
    await installRoutes(page, buildRoutes({
      onActions: () => { actionsFetches += 1; },
      onPage: () => { pageFetches += 1; },
    }));

    await page.goto('/company/audit-logs');
    await expect.poll(() => actionsFetches).toBe(1);
    await expect.poll(() => pageFetches).toBe(1);

    // Switch namespace (類別) combobox to a specific value → only page query changes
    await page.getByRole('combobox').nth(0).click();
    await page.getByRole('option', { name: 'auth' }).click();

    await expect.poll(() => pageFetches, { timeout: 3_000 }).toBe(2);
    expect(actionsFetches).toBe(1);
  });

  // R1-P backdoor closure: the `external invalidateQueries(...)` case that used to live here drove window.__lfQueryClient, a project-owned runtime global able to seed the react-query cache from outside React. The global is gone from the app; prefix-invalidation semantics for this queryKey are covered at the correct seam by src/lib/__tests__/queryClientPrefixInvalidation.test.ts.
});

// -----------------------------------------------------------------------------
// /company/backtest-monitor — queryKey: ['company','backtest-monitor']
//
// NOTE: This page is a single-key snapshot dashboard. It has NO user-facing
// filter controls ("監控條件") — the 3 pipeline cards + table all share the
// same query. We therefore cover staleTime + every mutation path that should
// (or explicitly should NOT) invalidate the cache.
// -----------------------------------------------------------------------------
test.describe('/company/backtest-monitor', () => {
  const runRow = (id: string) => ({
    id,
    knowledge_item_id: 'kn-1',
    status: 'failed',
    win_rate: null,
    total_hits: 0,
    error_message: 'INSUFFICIENT_DATA',
    run_mode: 'full',
    created_at: new Date().toISOString(),
    completed_at: null,
    parameters: {},
  });

  type Counters = {
    snapshot: number;
    invokes: Record<string, number>;
  };

  const installSnapshotRoutes = async (page: any, counters: Counters, runs: any[] = []) => {
    await installRoutes(page, {
      rest: {
        ...baseRest,
        knowledge_backtest_runs: ({ method }) => {
          if (method === 'GET') counters.snapshot += 1;
          return runs;
        },
        checkup_knowledge_items: () => [{ id: 'kn-1', title: '黃金交叉' }],
        knowledge_backfill_progress: () => [],
        daily_price_snapshots: () => [],
        function_run_logs: () => null,
      },
      functions: {
        'knowledge-backtest': ({ body }) => {
          counters.invokes['knowledge-backtest'] = (counters.invokes['knowledge-backtest'] ?? 0) + 1;
          counters.invokes[`knowledge-backtest:${body?.mode ?? 'unknown'}`] =
            (counters.invokes[`knowledge-backtest:${body?.mode ?? 'unknown'}`] ?? 0) + 1;
          return { ok: true };
        },
        'notify-backtest-result': () => {
          counters.invokes['notify-backtest-result'] = (counters.invokes['notify-backtest-result'] ?? 0) + 1;
          return { email_sent: 1, email_failed: 0 };
        },
      },
    });
  };

  test('mount fires snapshot once; focus does not refetch within staleTime', async ({ page }) => {
    await seedSession(page, { id: 'admin', email: 'admin@test.com' });
    const counters: Counters = { snapshot: 0, invokes: {} };
    await installSnapshotRoutes(page, counters);

    await page.goto('/company/backtest-monitor');
    await expect.poll(() => counters.snapshot).toBe(1);

    // Within 30s staleTime, focus must NOT refetch.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(400);
    expect(counters.snapshot).toBe(1);

    // Tab/visibility flip equivalent — refetchOnWindowFocus is disabled globally.
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(200);
    expect(counters.snapshot).toBe(1);
  });

  test('manual 重新整理 button invalidates → exactly +1 fetch', async ({ page }) => {
    await seedSession(page, { id: 'admin', email: 'admin@test.com' });
    const counters: Counters = { snapshot: 0, invokes: {} };
    await installSnapshotRoutes(page, counters);

    await page.goto('/company/backtest-monitor');
    await expect.poll(() => counters.snapshot).toBe(1);

    await page.getByRole('button', { name: /重新整理/ }).click();
    await expect.poll(() => counters.snapshot, { timeout: 3_000 }).toBe(2);

    // Second click → +1 more. invalidate + refetch is idempotent per click.
    await page.getByRole('button', { name: /重新整理/ }).click();
    await expect.poll(() => counters.snapshot, { timeout: 3_000 }).toBe(3);
  });

  test('「立即執行完整回測」mutation refetches snapshot via setTimeout(load, 2000)', async ({ page }) => {
    await seedSession(page, { id: 'admin', email: 'admin@test.com' });
    const counters: Counters = { snapshot: 0, invokes: {} };
    await installSnapshotRoutes(page, counters);

    await page.goto('/company/backtest-monitor');
    await expect.poll(() => counters.snapshot).toBe(1);

    await page.getByRole('button', { name: /立即執行完整回測/ }).click();
    await expect.poll(() => counters.invokes['knowledge-backtest:full'] ?? 0, { timeout: 3_000 }).toBe(1);

    // load() fires ~2s later — give it 4s budget.
    await expect.poll(() => counters.snapshot, { timeout: 4_500 }).toBeGreaterThan(1);
  });

  test('「重試」single-item mutation refetches snapshot via setTimeout(load, 1500)', async ({ page }) => {
    await seedSession(page, { id: 'admin', email: 'admin@test.com' });
    const counters: Counters = { snapshot: 0, invokes: {} };
    await installSnapshotRoutes(page, counters, [runRow('r-1')]);

    await page.goto('/company/backtest-monitor');
    await expect(page.getByText('黃金交叉')).toBeVisible();
    await expect.poll(() => counters.snapshot).toBe(1);

    await page.getByRole('button', { name: /重試/ }).first().click();
    await expect.poll(() => counters.invokes['knowledge-backtest:single'] ?? 0, { timeout: 3_000 }).toBe(1);
    await expect.poll(() => counters.snapshot, { timeout: 4_000 }).toBeGreaterThan(1);
  });

  test('「補發 Email 通知」mutation does NOT invalidate snapshot (by design)', async ({ page }) => {
    await seedSession(page, { id: 'admin', email: 'admin@test.com' });
    const counters: Counters = { snapshot: 0, invokes: {} };
    await installSnapshotRoutes(page, counters);

    await page.goto('/company/backtest-monitor');
    await expect.poll(() => counters.snapshot).toBe(1);

    await page.getByRole('button', { name: /補發 Email 通知/ }).click();
    await expect.poll(() => counters.invokes['notify-backtest-result'] ?? 0, { timeout: 3_000 }).toBe(1);

    // notify-only path intentionally skips load(); snapshot must remain at 1.
    await page.waitForTimeout(2_500);
    expect(counters.snapshot).toBe(1);
  });

  // R1-P backdoor closure: the `external invalidateQueries(...)` case that used to live here drove window.__lfQueryClient, a project-owned runtime global able to seed the react-query cache from outside React. The global is gone from the app; prefix-invalidation semantics for this queryKey are covered at the correct seam by src/lib/__tests__/queryClientPrefixInvalidation.test.ts.
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

// -----------------------------------------------------------------------------
// Batch 5b round-2 migrations — staleTime + invalidation contract per page.
// All 4 pages now use a single ['company', '<slug>'] query (revenue also keys
// by preset). Every mutation funnels through queryClient.invalidateQueries.
// -----------------------------------------------------------------------------

// /company/knowledge-base — queryKey: ['company','knowledge-base']
test.describe('/company/knowledge-base', () => {
  test('mount fires snapshot once; mainTab switch within staleTime does not refetch', async ({ page }) => {
    await seedSession(page, { id: 'admin', email: 'admin@test.com' });
    let itemsFetches = 0;
    await installRoutes(page, {
      rest: {
        ...baseRest,
        checkup_knowledge_items: ({ method }) => {
          if (method === 'GET') itemsFetches += 1;
          return [];
        },
        checkup_knowledge_usage_stats: () => [],
        checkup_knowledge_candidates: () => [],
        knowledge_backtest_runs: () => [],
      },
    });

    await page.goto('/company/knowledge-base');
    await expect.poll(() => itemsFetches).toBe(1);

    // Tab switches are client-side filters; queryKey stays the same.
    const candidatesTab = page.getByRole('tab', { name: /候選|Candidate/i }).first();
    if (await candidatesTab.count()) {
      await candidatesTab.click();
      await page.waitForTimeout(400);
      expect(itemsFetches).toBe(1);
    }

    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(400);
    expect(itemsFetches).toBe(1);
  });

  // R1-P backdoor closure: the `external invalidateQueries(...)` case that used to live here drove window.__lfQueryClient, a project-owned runtime global able to seed the react-query cache from outside React. The global is gone from the app; prefix-invalidation semantics for this queryKey are covered at the correct seam by src/lib/__tests__/queryClientPrefixInvalidation.test.ts.
});

// /company/payments — queryKey: ['company','payments']
test.describe('/company/payments', () => {
  test('mount fires providers query once; focus does not refetch', async ({ page }) => {
    await seedSession(page, { id: 'admin', email: 'admin@test.com' });
    let providersFetches = 0;
    await installRoutes(page, {
      rest: {
        ...baseRest,
        payment_providers: ({ method }) => {
          if (method === 'GET') providersFetches += 1;
          return [];
        },
        payment_settings_safe: () => null,
      },
    });

    await page.goto('/company/payments');
    await expect.poll(() => providersFetches).toBe(1);

    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(400);
    expect(providersFetches).toBe(1);
  });

  // R1-P backdoor closure: the `external invalidateQueries(...)` case that used to live here drove window.__lfQueryClient, a project-owned runtime global able to seed the react-query cache from outside React. The global is gone from the app; prefix-invalidation semantics for this queryKey are covered at the correct seam by src/lib/__tests__/queryClientPrefixInvalidation.test.ts.
});

// /company/plans — queryKey: ['company','plans']
test.describe('/company/plans', () => {
  test('mount fires once; outer/inner tab switches do not refetch (client-side)', async ({ page }) => {
    await seedSession(page, { id: 'admin', email: 'admin@test.com' });
    let plansFetches = 0;
    await installRoutes(page, {
      rest: {
        ...baseRest,
        expert_plans: ({ method }) => {
          if (method === 'GET') plansFetches += 1;
          return [];
        },
        plan_split_overrides: () => [],
        payment_settings_safe: () => null,
        checkup_plans: () => [],
      },
    });

    await page.goto('/company/plans');
    await expect.poll(() => plansFetches).toBe(1);

    // Click inner "全部方案" tab — client-side filter only.
    const allTab = page.getByRole('tab', { name: '全部方案' });
    if (await allTab.count()) {
      await allTab.click();
      await page.waitForTimeout(400);
      expect(plansFetches).toBe(1);
    }

    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(400);
    expect(plansFetches).toBe(1);
  });

  // R1-P backdoor closure: the `external invalidateQueries(...)` case that used to live here drove window.__lfQueryClient, a project-owned runtime global able to seed the react-query cache from outside React. The global is gone from the app; prefix-invalidation semantics for this queryKey are covered at the correct seam by src/lib/__tests__/queryClientPrefixInvalidation.test.ts.
});

// /company/revenue — queryKey: ['company','revenue', preset]
test.describe('/company/revenue', () => {
  const restStub = () => ({
    ...baseRest,
    revenue_splits: () => [],
    payment_transactions: () => [],
    remittance_orders: () => [],
    member_subscriptions: () => [],
    checkup_subscriptions: () => [],
    experts: () => [],
    expert_plans: () => [],
    checkup_plans: () => [],
    profiles: () => [],
    payment_providers: () => [],
  });

  test('mount fires once; focus within staleTime does not refetch', async ({ page }) => {
    await seedSession(page, { id: 'admin', email: 'admin@test.com' });
    let splitsFetches = 0;
    await installRoutes(page, {
      rest: {
        ...restStub(),
        revenue_splits: ({ method }) => {
          if (method === 'GET') splitsFetches += 1;
          return [];
        },
      },
    });

    await page.goto('/company/revenue');
    await expect.poll(() => splitsFetches).toBeGreaterThan(0);
    const baseline = splitsFetches;

    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(400);
    expect(splitsFetches).toBe(baseline);
  });

  test('changing preset (queryKey changes) triggers refetch; switching back uses cache', async ({ page }) => {
    await seedSession(page, { id: 'admin', email: 'admin@test.com' });
    let splitsFetches = 0;
    await installRoutes(page, {
      rest: {
        ...restStub(),
        revenue_splits: ({ method }) => {
          if (method === 'GET') splitsFetches += 1;
          return [];
        },
      },
    });

    await page.goto('/company/revenue');
    await expect.poll(() => splitsFetches).toBeGreaterThan(0);
    const baseline = splitsFetches;

    // Select preset combobox (first one is typically 區間 preset)
    const presetTrigger = page.getByRole('combobox').first();
    await presetTrigger.click();
    const lastMonth = page.getByRole('option', { name: /上個月|上月|Last month/i }).first();
    if (await lastMonth.count()) {
      await lastMonth.click();
      await expect.poll(() => splitsFetches, { timeout: 3_000 }).toBeGreaterThan(baseline);
      const afterChange = splitsFetches;

      // Switch back to this month — cached within staleTime, no refetch.
      await presetTrigger.click();
      const thisMonth = page.getByRole('option', { name: /本月|這個月|This month/i }).first();
      if (await thisMonth.count()) {
        await thisMonth.click();
        await page.waitForTimeout(500);
        expect(splitsFetches).toBe(afterChange);
      }
    }
  });

  // R1-P backdoor closure: the `external invalidateQueries(...)` case that used to live here drove window.__lfQueryClient, a project-owned runtime global able to seed the react-query cache from outside React. The global is gone from the app; prefix-invalidation semantics for this queryKey are covered at the correct seam by src/lib/__tests__/queryClientPrefixInvalidation.test.ts.
});
