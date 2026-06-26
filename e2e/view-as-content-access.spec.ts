/**
 * F4 — view-as 視角檢視 mock e2e
 *
 * 驗證：
 *   1. ViewAsBanner 在 sessionStorage 有 view-as-session-v1 時顯示
 *   2. useEffectiveUserId 在 view-as active 時改用 targetUserId 拉訂閱
 *      → /app/expert/:slug 的訂閱狀態反映被模擬的會員，而非 admin 本身
 *
 * 守護 ViewAsContext / useEffectiveUserId / useMemberSubscriptions /
 * ExpertDetail 內訂閱判斷的回歸。
 */
import { test, expect } from '@playwright/test';
import { seedSession, installRoutes } from './helpers/supabase-mock';

const ADMIN = { id: 'admin-1', email: 'admin@test.io' };
const TARGET = { id: 'member-target-1', email: 'member@test.io' };
const EXPERT_ID = 'exp-view-as';
const EXPERT_SLUG = 'view-as-alice';
const PLAN_ID = 'plan-view-as';

test.describe('F4 view-as 視角檢視', () => {
  test('啟用 view-as 後，banner 顯示被模擬會員、訂閱狀態跟著切換', async ({ page }) => {
    await seedSession(page, ADMIN);

    // Seed view-as session in sessionStorage BEFORE the app boots
    await page.addInitScript(({ admin, target }) => {
      const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
      sessionStorage.setItem('view-as-session-v1', JSON.stringify({
        adminUserId: admin.id,
        targetUserId: target.id,
        targetEmail: target.email,
        targetDisplayName: 'Target Member',
        targetRoles: [],
        targetActiveExpertSubs: 1,
        targetActiveCheckupSubs: 0,
        expiresAt,
      }));
    }, { admin: ADMIN, target: TARGET });

    let memberSubsCalls = 0;
    let lastSubsUserIdFilter: string | null = null;

    await installRoutes(page, {
      rest: {
        experts: () => [{
          id: EXPERT_ID, slug: EXPERT_SLUG, name: 'Alice',
          role: 'advisor', avatar_url: null, status: 'active',
          tagline: '', bio: '', social_links: {},
        }],
        expert_plans: () => [{
          id: PLAN_ID, expert_id: EXPERT_ID, name: '訊號方案',
          plan_type: 'analyst_signal_l1', price_monthly: 599, price_yearly: 5990,
          description: '', features: [], is_active: true,
        }],
        member_subscriptions: ({ url }) => {
          memberSubsCalls += 1;
          const userIdFilter = url.searchParams.get('user_id') || '';
          lastSubsUserIdFilter = userIdFilter;
          // Return active sub only when querying the TARGET user id
          if (userIdFilter.includes(TARGET.id)) {
            return [{
              id: 'sub-tgt-1', user_id: TARGET.id, plan_id: PLAN_ID,
              status: 'active', auto_renew: false, billing_cycle: 'monthly',
              started_at: new Date(Date.now() - 86400_000).toISOString(),
              expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
              canceled_at: null,
            }];
          }
          return [];
        },
        get_expert_detail_bundle: () => ({
          expert: { id: EXPERT_ID, slug: EXPERT_SLUG, name: 'Alice', role: 'advisor', status: 'active' },
          plans: [{ id: PLAN_ID, name: '訊號方案', plan_type: 'analyst_signal_l1', price_monthly: 599, price_yearly: 5990 }],
        }),
        profiles: () => null,
        user_roles: () => [],
      },
      functions: {
        'admin-view-as': () => ({ ok: true }),
      },
    });

    await page.goto(`/app/expert/${EXPERT_SLUG}`);
    await page.waitForLoadState('domcontentloaded');

    // 1) Banner must be visible with target email
    await expect(page.getByText(TARGET.email)).toBeVisible({ timeout: 8000 });

    // 2) member_subscriptions was queried with the TARGET user id, not admin
    await page.waitForTimeout(500);
    expect(memberSubsCalls).toBeGreaterThan(0);
    expect(lastSubsUserIdFilter, 'view-as active 時應以 target user id 查 member_subscriptions').toContain(TARGET.id);
    expect(lastSubsUserIdFilter, 'view-as active 時不應以 admin id 查訂閱').not.toContain(ADMIN.id);
  });

  test('沒有 view-as session 時，banner 不顯示且訂閱查 admin 自己', async ({ page }) => {
    await seedSession(page, ADMIN);

    let lastSubsUserIdFilter: string | null = null;
    await installRoutes(page, {
      rest: {
        experts: () => [{ id: EXPERT_ID, slug: EXPERT_SLUG, name: 'Alice', role: 'advisor', avatar_url: null, status: 'active' }],
        expert_plans: () => [{ id: PLAN_ID, expert_id: EXPERT_ID, name: 'p', plan_type: 'analyst_signal_l1', price_monthly: 1, price_yearly: 10 }],
        member_subscriptions: ({ url }) => {
          lastSubsUserIdFilter = url.searchParams.get('user_id') || '';
          return [];
        },
        get_expert_detail_bundle: () => ({
          expert: { id: EXPERT_ID, slug: EXPERT_SLUG, name: 'Alice', role: 'advisor', status: 'active' },
          plans: [{ id: PLAN_ID, name: 'p', plan_type: 'analyst_signal_l1', price_monthly: 1, price_yearly: 10 }],
        }),
        profiles: () => null,
        user_roles: () => [],
      },
    });

    await page.goto(`/app/expert/${EXPERT_SLUG}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    await expect(page.getByText(TARGET.email)).toHaveCount(0);
    expect(lastSubsUserIdFilter || '').toContain(ADMIN.id);
  });
});
