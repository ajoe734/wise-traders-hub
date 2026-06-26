/**
 * F4b — view-as 視角寫入守門
 *
 * 驗證進入 view-as 後：
 *   1. NotificationBell 載入 notifications 用的是 targetUserId（query 帶 user_id=eq.target）
 *   2. 點「全部已讀」不會發出 UPDATE notifications（write-guard）
 *
 * 守護 NotificationBell view-as 改造 + isViewAs 寫入封鎖。
 */
import { test, expect } from '@playwright/test';
import { seedSession, installRoutes } from './helpers/supabase-mock';

const ADMIN = { id: 'admin-vp-1', email: 'admin@view-parity.io' };
const TARGET = { id: 'member-vp-1', email: 'member@view-parity.io' };

test.describe('F4b view-as write-guard', () => {
  test('NotificationBell 讀取 target，markAllRead 在 view-as 不發 UPDATE', async ({ page }) => {
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
    let notifUpdateCount = 0;

    await installRoutes(page, {
      'GET /rest/v1/notifications': (req) => {
        notifSelectFilter = new URL(req.url()).searchParams.get('user_id');
        return [
          { id: 'n1', user_id: TARGET.id, title: 'test', body: 'b', link: null, is_read: false, created_at: new Date().toISOString() },
        ];
      },
      'PATCH /rest/v1/notifications': () => {
        notifUpdateCount += 1;
        return [];
      },
    });

    await page.goto('/app');
    // bell appears in header
    const bell = page.getByRole('button', { name: /通知|notifications/i }).first();
    await expect(bell).toBeVisible({ timeout: 10_000 });
    await bell.click();

    // wait notifications load
    await page.waitForFunction(() => true);
    await page.waitForTimeout(400);

    expect(notifSelectFilter, 'notifications 必須以 targetUserId 過濾').toContain(TARGET.id);

    // try mark all read
    const markAll = page.getByRole('button', { name: /全部已讀|mark all/i });
    if (await markAll.count()) {
      await markAll.first().click();
      await page.waitForTimeout(300);
    }
    expect(notifUpdateCount, 'view-as 模式下 markAllRead 不可寫入 notifications').toBe(0);
  });
});
