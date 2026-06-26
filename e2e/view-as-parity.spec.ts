/**
 * F4b — view-as 視角寫入守門
 *
 * 驗證進入 view-as 後：
 *   1. NotificationBell 載入 notifications 用的是 targetUserId（query 帶 user_id=eq.target）
 *   2. 點「全部已讀」不會發出 PATCH notifications（write-guard）
 *
 * 守護 NotificationBell view-as 改造 + isViewAs 寫入封鎖。
 */
import { test, expect } from '@playwright/test';
import { seedSession, installRoutes } from './helpers/supabase-mock';

const ADMIN = { id: 'admin-vp-1', email: 'admin@view-parity.io' };
const TARGET = { id: 'member-vp-1', email: 'member@view-parity.io' };
const EXPERT_ID = 'exp-vp';
const EXPERT_SLUG = 'view-parity-alice';
const PLAN_ID = 'plan-vp';

test.describe('F4b view-as write-guard', () => {
  test('NotificationBell 讀取 target，markAllRead 在 view-as 不發 PATCH', async ({ page }) => {
    await seedSession(page, ADMIN);

    await page.addInitScript(({ admin, target }) => {
      const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
      sessionStorage.setItem('view-as-session-v1', JSON.stringify({
        adminUserId: admin.id,
        targetUserId: target.id,
        targetEmail: target.email,
        targetDisplayName: 'Target Parity',
        targetRoles: [],
        targetActiveExpertSubs: 0,
        targetActiveCheckupSubs: 0,
        expiresAt,
      }));
    }, { admin: ADMIN, target: TARGET });

    let notifSelectFilter: string | null = null;
    let notifPatchCount = 0;

    await installRoutes(page, {
      rest: {
        experts: () => [{
          id: EXPERT_ID, slug: EXPERT_SLUG, name: 'Alice',
          role: 'advisor', avatar_url: null, status: 'active',
          tagline: '', bio: '', social_links: {},
        }],
        expert_plans: () => [{
          id: PLAN_ID, expert_id: EXPERT_ID, name: 'p',
          plan_type: 'analyst_signal_l1', price_monthly: 1, price_yearly: 10,
        }],
        member_subscriptions: () => [],
        get_expert_detail_bundle: () => ({
          expert: { id: EXPERT_ID, slug: EXPERT_SLUG, name: 'Alice', role: 'advisor', status: 'active' },
          plans: [{ id: PLAN_ID, name: 'p', plan_type: 'analyst_signal_l1', price_monthly: 1, price_yearly: 10 }],
        }),
        profiles: () => null,
        user_roles: () => [],
      },
      functions: { 'admin-view-as': () => ({ ok: true }) },
    });

    // Add specific notifications interceptor AFTER installRoutes so it takes priority.
    await page.route('https://yqacmrgdjlenbijclngi.supabase.co/rest/v1/notifications**', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (req.method() === 'PATCH') {
        notifPatchCount += 1;
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      }
      if (req.method() === 'GET') {
        notifSelectFilter = url.searchParams.get('user_id');
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            { id: 'n1', user_id: TARGET.id, title: 'test', body: 'b', link: null, is_read: false, created_at: new Date().toISOString() },
          ]),
        });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    await page.goto(`/app/expert/${EXPERT_SLUG}`);
    await page.waitForLoadState('domcontentloaded');

    const bell = page.getByRole('button', { name: '通知' }).first();
    await expect(bell).toBeVisible({ timeout: 10_000 });
    await bell.click();

    await page.waitForTimeout(500);
    expect(notifSelectFilter, 'notifications 必須以 targetUserId 過濾').toContain(TARGET.id);
    expect(notifSelectFilter || '').not.toContain(ADMIN.id);

    const markAll = page.getByRole('button', { name: '全部已讀' });
    if (await markAll.count()) {
      await markAll.first().click();
      await page.waitForTimeout(300);
    }
    expect(notifPatchCount, 'view-as 模式下 markAllRead 不可寫入 notifications').toBe(0);
  });
});
