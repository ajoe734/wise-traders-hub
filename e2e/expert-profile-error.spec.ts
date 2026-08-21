import { test, expect } from '@playwright/test';
import { installRoutes, seedSession } from './helpers/supabase-mock';

/**
 * /expert/:slug（公開頁，走 useExpertDetailBundle / get_expert_detail_bundle RPC）
 *
 * 當 RPC 回 5xx 時，ExpertProfile 應渲染 ExpertFetchError（「專家資料載入失敗」+
 * 「重新載入」CTA），而不是讓 query throw 衝出 AppErrorBoundary。
 */

test.describe('/expert/:slug RPC 錯誤回退', () => {
  test('真實 master-brian route Refresh 後績效 section 不得只剩標題', async ({ page }) => {
    const consoleErrors: string[] = [];
    const failedResponses: string[] = [];
    const sensitiveRequests: string[] = [];
    const sensitiveTables = ['trade_records', 'expert_signals', 'payment_settings', 'subscriptions'];

    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('response', (response) => {
      if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
    });
    page.on('request', (request) => {
      if (sensitiveTables.some((table) => request.url().includes(table))) {
        sensitiveRequests.push(request.url());
      }
    });

    await page.goto('/expert/master-brian?refresh=performance-parent-contract', {
      waitUntil: 'networkidle',
    });
    await page.reload({ waitUntil: 'networkidle' });

    const section = page
      .getByRole('heading', { name: '績效總覽' })
      .locator('xpath=ancestor::section[1]');
    await expect(section).toBeVisible();
    await expect.poll(async () => (await section.innerText()).trim()).not.toBe('績效總覽');

    const text = await section.innerText();
    expect(['尚無可公開紀錄', '資料暫時無法取得'].some((copy) => text.includes(copy))).toBe(true);
    expect(text).not.toMatch(/(?:^|\s)[+-]?0(?:\.00)?%(?:\s|$)/);
    expect(consoleErrors).toEqual([]);
    expect(failedResponses).toEqual([]);
    expect(sensitiveRequests).toEqual([]);
  });

  test('get_expert_detail_bundle 500 → 顯示 ExpertFetchError，不觸發 ErrorBoundary', async ({ page }) => {
    let bundleCalls = 0;

    await installRoutes(page, {
      rest: {
        // 公開頁，不需要 session；profiles/user_roles 不應該被呼叫，留空即 [].
        get_expert_detail_bundle: () => {
          bundleCalls += 1;
          return { __status: 500, body: { message: 'mock_bundle_failure' } };
        },
      },
    });

    const pageErrors: Error[] = [];
    page.on('pageerror', (e) => pageErrors.push(e));

    await page.goto('/expert/master-explode');

    // ExpertFetchError (full variant) 文案 + 重試按鈕
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByText('專家資料載入失敗')).toBeVisible();
    await expect(page.getByRole('button', { name: '重新載入' })).toBeVisible();

    // 絕不可被 AppErrorBoundary 接住
    await expect(page.getByText('頁面發生錯誤')).toHaveCount(0);
    await expect(page.getByText('很抱歉，此頁面遇到非預期錯誤')).toHaveCount(0);

    // 不可有 Rules of Hooks runtime error
    const hookErr = pageErrors.find((e) =>
      /Rendered (more|fewer) hooks than|change in the order of Hooks/i.test(e.message),
    );
    expect(hookErr, hookErr?.message).toBeUndefined();

    // expertRetry: failureCount < 2 → 至少嘗試 2 次以上才放棄，證實 retry 鏈有跑。
    expect(bundleCalls).toBeGreaterThanOrEqual(2);
  });

  test('錯誤後按「重新載入」→ RPC 成功 → 渲染專家頁', async ({ page }) => {
    let bundleCalls = 0;

    await installRoutes(page, {
      rest: {
        get_expert_detail_bundle: () => {
          bundleCalls += 1;
          // 前 3 次（含 retry）都失敗，第 4 次起回正常 bundle。
          if (bundleCalls <= 3) {
            return { __status: 500, body: { message: 'mock_bundle_failure' } };
          }
          return {
            expert: {
              id: 'expert-1',
              slug: 'master-explode',
              name: '測試大師',
              bio: '回歸測試用',
              role: 'advisor',
              status: 'active',
              is_active: true,
              avatar_url: null,
              style_tags: [],
              starting_capital: 1_000_000,
            },
            plans: [],
            subscriber_count: 0,
            my_subscribed_plan_ids: [],
          };
        },
      },
    });

    const pageErrors: Error[] = [];
    page.on('pageerror', (e) => pageErrors.push(e));

    await page.goto('/expert/master-explode');

    await expect(page.getByText('專家資料載入失敗')).toBeVisible();
    await page.getByRole('button', { name: '重新載入' }).click();

    await expect(page.getByRole('heading', { name: '測試大師' }).first()).toBeVisible();
    await expect(page.getByText('專家資料載入失敗')).toHaveCount(0);
    await expect(page.getByText('頁面發生錯誤')).toHaveCount(0);
    expect(pageErrors, pageErrors.map((e) => e.message).join('\n')).toHaveLength(0);
  });

  test('錯誤頁未登入 → 點「返回專家列表」導回 /experts，不觸發 ErrorBoundary', async ({ page }) => {
    await installRoutes(page, {
      rest: {
        get_expert_detail_bundle: () => ({ __status: 500, body: { message: 'mock_bundle_failure' } }),
        // /experts 列表頁需要 experts 表回空陣列即可（避免再次 500）。
        experts: () => [],
      },
    });

    const pageErrors: Error[] = [];
    page.on('pageerror', (e) => pageErrors.push(e));

    await page.goto('/expert/master-explode');
    await expect(page.getByText('專家資料載入失敗')).toBeVisible();

    await page.getByRole('button', { name: '返回專家列表' }).click();

    await expect(page).toHaveURL(/\/experts(\?|$)/);
    await expect(page.getByText('頁面發生錯誤')).toHaveCount(0);
    await expect(page.getByText('很抱歉，此頁面遇到非預期錯誤')).toHaveCount(0);
    expect(pageErrors, pageErrors.map((e) => e.message).join('\n')).toHaveLength(0);
  });

  test('錯誤頁已登入 → 點「返回探索專家」導回 /app/explore，不觸發 ErrorBoundary', async ({ page }) => {
    await seedSession(page, { id: 'user-admin', email: 'admin@test.com' });
    await installRoutes(page, {
      rest: {
        profiles: () => ({
          display_name: 'Admin Tester',
          expert_slug: null,
          avatar_url: null,
          line_user_id: null,
          is_tester: false,
        }),
        user_roles: () => [{ role: 'company_admin' }],
        get_expert_detail_bundle: () => ({ __status: 500, body: { message: 'mock_bundle_failure' } }),
        // /app/explore 用到的清單 RPC 統一回空，避免次生 5xx。
        experts: () => [],
        expert_plans: () => [],
        member_subscriptions: () => [],
      },
    });

    const pageErrors: Error[] = [];
    page.on('pageerror', (e) => pageErrors.push(e));

    await page.goto('/expert/master-explode');
    await expect(page.getByText('專家資料載入失敗')).toBeVisible();

    await page.getByRole('button', { name: '返回探索專家' }).click();

    await expect(page).toHaveURL(/\/app\/explore(\?|$)/);
    await expect(page.getByText('頁面發生錯誤')).toHaveCount(0);
    await expect(page.getByText('很抱歉，此頁面遇到非預期錯誤')).toHaveCount(0);
    const hookErr = pageErrors.find((e) =>
      /Rendered (more|fewer) hooks than|change in the order of Hooks/i.test(e.message),
    );
    expect(hookErr, hookErr?.message).toBeUndefined();
  });
});
