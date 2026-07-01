import { test, expect } from '@playwright/test';
import { seedSession, installRoutes } from './helpers/supabase-mock';

/**
 * /company/account-merges — 排序 URL 雙向同步 + CSV 匯出 loading/中止/重試/錯誤。
 *
 * 全站 route 使用 supabase-mock 掛接，避免真的打 Supabase。
 */

const NOW = Date.now();

function makeRow(i: number) {
  return {
    id: `merge-${i}`,
    primary_user_id: `00000000-0000-0000-0000-00000000${String(i).padStart(4, '0')}`,
    secondary_user_id: `11111111-1111-1111-1111-11111111${String(i).padStart(4, '0')}`,
    primary_identity: 'email',
    secondary_identity: 'line',
    primary_email: `p${i}@e2e.local`,
    secondary_email: `s${i}@e2e.local`,
    moved_counts: { notifications: 1, _sub_conflicts: [] },
    performed_by: null,
    created_at: new Date(NOW - i * 3600_000).toISOString(),
  };
}

function baseRestFactory(opts: {
  onMerge?: (url: URL) => any; // 允許測試覆寫 account_merges 回應（可回 Promise / error envelope）
} = {}) {
  const rows = [makeRow(1), makeRow(2), makeRow(3)];
  return {
    profiles: () => ({ display_name: 'Admin', is_tester: false }),
    user_roles: () => [{ role: 'company_admin' }],
    audit_logs: () => [],
    account_merges: ({ url }: any) => {
      if (opts.onMerge) {
        const r = opts.onMerge(url);
        if (r !== undefined) return r;
      }
      return rows;
    },
  } as Record<string, (req: any) => any>;
}

test.describe('/company/account-merges 排序 URL 同步', () => {
  test('點擊排序表頭 → URL 出現 sort/dir，並下發 order 到 REST', async ({ page }) => {
    const orderQueries: string[] = [];
    await seedSession(page, { id: 'admin-1', email: 'admin@e2e.local', role: 'company_admin' });
    await installRoutes(page, {
      rest: baseRestFactory({
        onMerge: (url) => {
          orderQueries.push(url.searchParams.get('order') || '');
          return undefined;
        },
      }),
    });

    await page.goto('/company/account-merges');
    await page.locator('[data-testid="merge-table"]').waitFor();

    // 預設 created_at.desc
    expect(orderQueries.at(-1)).toContain('created_at.desc');
    expect(new URL(page.url()).searchParams.has('sort')).toBe(false);

    // 點 Primary 表頭 → asc
    await page.locator('[data-testid="merge-sort-primary_user_id"]').click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get('sort'))
      .toBe('primary_user_id');
    expect(new URL(page.url()).searchParams.get('dir')).toBe('asc');
    await expect
      .poll(() => orderQueries.at(-1) || '')
      .toContain('primary_user_id.asc');

    // 再點一次 → desc
    await page.locator('[data-testid="merge-sort-primary_user_id"]').click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get('dir'))
      .toBe('desc');
  });

  test('分享 URL 帶 sort=secondary_user_id&dir=desc → 重整可回復同狀態', async ({ page }) => {
    const orderQueries: string[] = [];
    await seedSession(page, { id: 'admin-1', email: 'admin@e2e.local', role: 'company_admin' });
    await installRoutes(page, {
      rest: baseRestFactory({
        onMerge: (url) => { orderQueries.push(url.searchParams.get('order') || ''); return undefined; },
      }),
    });

    await page.goto('/company/account-merges?sort=secondary_user_id&dir=desc');
    await page.locator('[data-testid="merge-table"]').waitFor();

    const th = page.locator('[data-testid="merge-sort-secondary_user_id"]');
    await expect(th).toHaveAttribute('data-sort-active', 'true');
    await expect(th).toHaveAttribute('data-sort-dir', 'desc');
    expect(orderQueries.some((o) => o.includes('secondary_user_id.desc'))).toBe(true);
  });
});

test.describe('/company/account-merges CSV 匯出狀態', () => {
  test('匯出中顯示 loading + 中止按鈕，點中止回到 idle', async ({ page }) => {
    let hangResolver: (v: any) => void = () => {};
    await seedSession(page, { id: 'admin-1', email: 'admin@e2e.local', role: 'company_admin' });
    await installRoutes(page, {
      rest: {
        profiles: () => ({ display_name: 'Admin', is_tester: false }),
        user_roles: () => [{ role: 'company_admin' }],
        audit_logs: () => [],
        account_merges: ({ url }) => {
          // 首屏（有 range 參數）快速回；export（無 range）掛住
          const isPaged = !!url.searchParams.get('limit') || !!url.searchParams.get('offset');
          if (isPaged) return [makeRow(1)];
          return new Promise((resolve) => { hangResolver = resolve; });
        },
      },
    });

    await page.goto('/company/account-merges');
    await page.locator('[data-testid="merge-export-csv"]').click();

    await expect(page.locator('[data-testid="merge-export-loading"]')).toBeVisible();
    const cancelBtn = page.locator('[data-testid="merge-export-cancel"]');
    await expect(cancelBtn).toBeVisible();

    await cancelBtn.click();
    await expect(page.locator('[data-testid="merge-export-csv"]')).toBeVisible();
    await expect(page.locator('[data-testid="merge-export-loading"]')).toHaveCount(0);
    hangResolver([]); // 釋放掛住的 request
  });

  test('匯出失敗顯示錯誤訊息 + 重試按鈕，重試後成功並下載 CSV', async ({ page }, testInfo) => {
    let attempt = 0;
    await seedSession(page, { id: 'admin-1', email: 'admin@e2e.local', role: 'company_admin' });
    await installRoutes(page, {
      rest: {
        profiles: () => ({ display_name: 'Admin', is_tester: false }),
        user_roles: () => [{ role: 'company_admin' }],
        audit_logs: () => [],
        account_merges: ({ url }) => {
          const isPaged = !!url.searchParams.get('limit') || !!url.searchParams.get('offset');
          if (isPaged) return [makeRow(1)];
          attempt += 1;
          if (attempt === 1) return { __status: 500, body: { message: 'boom' } };
          return [makeRow(1)];
        },
      },
    });

    await page.goto('/company/account-merges');
    await page.locator('[data-testid="merge-export-csv"]').click();

    const err = page.locator('[data-testid="merge-export-error"]');
    await expect(err).toBeVisible({ timeout: 5_000 });
    await expect(err).toContainText('匯出失敗');
    await expect(err).toContainText('boom');

    const retry = page.locator('[data-testid="merge-export-retry"]');
    await expect(retry).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      retry.click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^account_merges_\d+\.csv$/);
    await expect(page.locator('[data-testid="merge-export-error"]')).toHaveCount(0);
  });
});
