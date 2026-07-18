import { test, expect, type Page } from '@playwright/test';
import { seedSession, installRoutes } from './helpers/supabase-mock';

const EXPERT = {
  id: 'expert-admin-sidebar',
  user_id: 'owner-admin-sidebar',
  slug: 'brcto',
  name: 'brcto',
  bio: '',
  description: '',
  style_tags: [],
  markets: [],
  starting_capital: 1_000_000,
  avatar_url: null,
  status: 'active',
  role: 'mentor',
  expert_plans: [],
};

const VIEWPORTS = [
  { label: 'screenshot-809x593', width: 809, height: 593 },
  { label: 'short-desktop-1024x430', width: 1024, height: 430 },
  { label: 'laptop-1280x720', width: 1280, height: 720 },
  { label: 'tablet-768x1024', width: 768, height: 1024 },
] as const;

async function mockAdminRoutes(page: Page) {
  await seedSession(page, { id: 'company-admin-sidebar', email: 'admin-sidebar@test.com' });
  await installRoutes(page, {
    rest: {
      profiles: () => ({
        display_name: 'Admin Sidebar Tester',
        expert_slug: null,
        avatar_url: null,
        line_user_id: null,
        is_tester: false,
      }),
      user_roles: () => [{ role: 'company_admin' }],
      experts: () => [EXPERT],
      announcements: () => [],
      notifications: () => [],
    },
  });
}

test.describe('AdminLayout sidebar vertical scroll', () => {
  for (const viewport of VIEWPORTS) {
    test(`側邊欄導覽可滾到底且 footer 不被吃掉 @ ${viewport.label}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await mockAdminRoutes(page);

      await page.goto(`/admin/${EXPERT.slug}/announcements`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByText('分析師後台管理')).toBeVisible();

      const sidebar = page.getByRole('complementary', { name: '分析師後台側邊欄' });
      const nav = page.getByRole('navigation', { name: '分析師後台導覽' });
      const footerButton = page.getByRole('button', { name: '登出' });
      const lastNavLink = page.getByRole('link', { name: '個人檔案' });

      const metricsBefore = await nav.evaluate((el) => ({
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
        scrollTop: el.scrollTop,
        overflowY: getComputedStyle(el).overflowY,
      }));

      expect(metricsBefore.overflowY).toMatch(/auto|scroll/);

      await nav.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });

      if (metricsBefore.scrollHeight > metricsBefore.clientHeight + 1) {
        await expect.poll(() => nav.evaluate((el) => el.scrollTop), { timeout: 2_000 }).toBeGreaterThan(0);
      } else {
        await expect.poll(() => nav.evaluate((el) => el.scrollTop), { timeout: 2_000 }).toBe(0);
      }

      await expect(lastNavLink).toBeVisible();
      await expect(footerButton).toBeVisible();

      const geometry = await page.evaluate(() => {
        const sidebar = document.querySelector('[aria-label="分析師後台側邊欄"]') as HTMLElement | null;
        const nav = document.querySelector('[aria-label="分析師後台導覽"]') as HTMLElement | null;
        const footerButton = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('登出')) as HTMLElement | undefined;
        const s = sidebar?.getBoundingClientRect();
        const n = nav?.getBoundingClientRect();
        const f = footerButton?.getBoundingClientRect();
        return {
          viewportHeight: window.innerHeight,
          sidebarBottom: s?.bottom ?? 0,
          navBottom: n?.bottom ?? 0,
          footerBottom: f?.bottom ?? 0,
          footerTop: f?.top ?? 0,
        };
      });

      expect(geometry.sidebarBottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
      expect(geometry.navBottom).toBeLessThanOrEqual(geometry.footerTop + 1);
      expect(geometry.footerBottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
      const finalMetrics = await nav.evaluate((el) => ({
        atBottom: el.scrollTop + el.clientHeight >= el.scrollHeight - 1,
        scrollTop: el.scrollTop,
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
      }));
      expect(
        finalMetrics.atBottom,
        `nav 沒有真的滾到底：scrollTop=${finalMetrics.scrollTop}, clientHeight=${finalMetrics.clientHeight}, scrollHeight=${finalMetrics.scrollHeight}`,
      ).toBe(true);
    });
  }
});