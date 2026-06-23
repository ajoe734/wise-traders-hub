import { test, expect } from '@playwright/test';
import { seedSession, installRoutes } from './helpers/supabase-mock';

/**
 * /app/expert/:slug 回歸測試
 *
 * 1. 首次 render — 防止 usePreviewMode 之前被放在 early return 之後造成的
 *    "Rendered more hooks than during the previous render" 錯誤，
 *    表現為 AppErrorBoundary 直接吃掉整頁顯示「頁面發生錯誤」。
 * 2. 訂閱者預覽（company_admin 開新分頁，sessionStorage.previewExpertSlug 已設） —
 *    應顯示「已訂閱此專家」綠色卡片，不可有 PAGEERROR。
 */

const EXPERT = {
  id: 'expert-1',
  slug: 'master-test',
  name: '測試大師',
  bio: '回歸測試用',
  role: 'advisor',
  status: 'active',
  is_active: true,
  avatar_url: null,
  style_tags: [],
  starting_capital: 1_000_000,
  expert_plans: [
    {
      id: 'plan-1',
      plan_type: 'analyst_signal_l1',
      price_monthly: 1000,
      name: '跟單派',
      description: null,
      is_active: true,
      status: 'approved',
    },
  ],
};

function baseRoutes() {
  return {
    profiles: () => ({
      display_name: 'Admin Tester',
      expert_slug: null,
      avatar_url: null,
      line_user_id: null,
      is_tester: false,
    }),
    user_roles: () => [{ role: 'company_admin' }],
    experts: () => [EXPERT],
    expert_plans: () => EXPERT.expert_plans,
    member_subscriptions: () => [],
    get_expert_capital_status: () => null,
    calculate_expert_performance: () => null,
    get_expert_detail_bundle: () => ({
      expert: EXPERT,
      plans: EXPERT.expert_plans,
      subscriber_count: 0,
      my_subscribed_plan_ids: [],
    }),
  } as Record<string, (req: any) => any>;
}

test.describe('/app/expert/:slug', () => {
  test('首次 render 不會觸發 Rules of Hooks 錯誤', async ({ page }) => {
    await seedSession(page, { id: 'user-admin', email: 'admin@test.com' });
    await installRoutes(page, { rest: baseRoutes() });

    const pageErrors: Error[] = [];
    page.on('pageerror', (e) => pageErrors.push(e));

    await page.goto(`/app/expert/${EXPERT.slug}`);

    // 等專家姓名（H1）出現，代表已通過 isLoading 早回 → render 第二次 hook 順序也正確。
    await expect(page.getByRole('heading', { level: 1, name: EXPERT.name })).toBeVisible();

    // 不可出現 ErrorBoundary 文案
    await expect(page.getByText('頁面發生錯誤')).toHaveCount(0);
    await expect(page.getByText('很抱歉，此頁面遇到非預期錯誤')).toHaveCount(0);

    // 不可有 Rules of Hooks runtime error
    const hookErr = pageErrors.find((e) =>
      /Rendered (more|fewer) hooks than|change in the order of Hooks/i.test(e.message),
    );
    expect(hookErr, hookErr?.message).toBeUndefined();
  });

  test('訂閱者預覽：開新分頁應顯示「已訂閱此專家」', async ({ page }) => {
    await seedSession(page, { id: 'user-admin', email: 'admin@test.com' });

    // 模擬「在原分頁點預覽 → 開新分頁」: previewExpertSlug 已被前頁寫入 sessionStorage。
    await page.addInitScript((slug) => {
      try {
        sessionStorage.setItem('previewExpertSlug', slug);
      } catch {
        /* ignore */
      }
    }, EXPERT.slug);

    await installRoutes(page, { rest: baseRoutes() });

    const pageErrors: Error[] = [];
    page.on('pageerror', (e) => pageErrors.push(e));

    await page.goto(`/app/expert/${EXPERT.slug}`);

    await expect(page.getByRole('heading', { level: 1, name: EXPERT.name })).toBeVisible();
    await expect(page.getByText('已訂閱此專家')).toBeVisible();

    // 預覽下不應再渲染「立即訂閱」CTA
    await expect(page.getByRole('button', { name: '立即訂閱' })).toHaveCount(0);

    await expect(page.getByText('頁面發生錯誤')).toHaveCount(0);
    expect(pageErrors, pageErrors.map((e) => e.message).join('\n')).toHaveLength(0);
  });

  test('不存在的 slug：首次 render 應顯示「找不到此專家」而非 AppErrorBoundary', async ({ page }) => {
    await seedSession(page, { id: 'user-admin', email: 'admin@test.com' });

    const routes = baseRoutes();
    // 模擬 slug 完全找不到：experts/expert_plans/bundle 全部回空。
    routes.experts = () => [];
    routes.expert_plans = () => [];
    routes.get_expert_detail_bundle = () => ({
      expert: null,
      plans: [],
      subscriber_count: 0,
      my_subscribed_plan_ids: [],
    });

    await installRoutes(page, { rest: routes });

    const pageErrors: Error[] = [];
    page.on('pageerror', (e) => pageErrors.push(e));

    await page.goto('/app/expert/this-slug-does-not-exist');

    // 應渲染 ExpertDetail 自己的 not-found fallback
    await expect(page.getByText('找不到此專家')).toBeVisible();
    await expect(page.getByRole('button', { name: '返回戰情室' })).toBeVisible();

    // 絕不可被 AppErrorBoundary 接住
    await expect(page.getByText('頁面發生錯誤')).toHaveCount(0);
    await expect(page.getByText('很抱歉，此頁面遇到非預期錯誤')).toHaveCount(0);

    const hookErr = pageErrors.find((e) =>
      /Rendered (more|fewer) hooks than|change in the order of Hooks/i.test(e.message),
    );
    expect(hookErr, hookErr?.message).toBeUndefined();
    expect(pageErrors, pageErrors.map((e) => e.message).join('\n')).toHaveLength(0);
  });
});
