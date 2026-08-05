import { test, expect } from '@playwright/test';
import { seedSession, installRoutes } from './helpers/supabase-mock';

/**
 * 匯出績效 PDF — 日期範圍選項（成立以來／今年以來／近一年／近六月／近三月／自訂）
 * 與自訂區間的有效／無效驗證，以及 P3 最多 10 筆的口徑預覽。
 */

const EXPERT = {
  id: 'exp-1', slug: 'sharkgu', name: '彥愷', role: 'mentor', status: 'active',
  is_test: false, avatar_url: null, created_at: '2026-01-01T00:00:00Z',
  starting_capital: 1_000_000, currency: 'TWD', asset_class: 'tw_stock',
  strategy_summary: '波段', description: null, style_tags: ['尊重趨勢'], markets: ['台股'],
};


const trade = (i: number, exit: string) => ({
  id: `t${i}`, instrument: `S${i}`, entry_price: 100, exit_price: 110, current_price: null,
  quantity: 1000, entry_date: '2026-01-02', exit_date: exit, pnl_percent: 10, status: 'closed',
});

const TRADES = [
  trade(1, '2025-11-10'),
  trade(2, '2026-02-10'),
  trade(3, '2026-07-10'),
];

async function openDialog(page: import('@playwright/test').Page) {
  await seedSession(page, { id: 'admin-1', email: 'admin@e2e.local', role: 'company_admin' });
  await installRoutes(page, {
    rest: {
      profiles: () => ({ display_name: 'Admin', is_tester: false }),
      user_roles: () => [{ role: 'company_admin' }],
      experts: ({ url }) => {
        const select = url.searchParams.get('select') ?? '';
        // useExpert (AdminLayout) 走 select=*,expert_plans(*) 需要陣列；
        // useFactsheetSource 走 maybeSingle 需要單一物件。
        return select.includes('expert_plans')
          ? [{ ...EXPERT, expert_plans: [] }]
          : EXPERT;
      },
      trade_records: () => TRADES,
    },
  });
  await page.goto('/admin/sharkgu/performance');
  await page.getByTestId('factsheet-export-trigger').click();
  await expect(page.getByTestId('factsheet-export-dialog')).toBeVisible();
}

async function pickRange(page: import('@playwright/test').Page, label: string) {
  await page.getByTestId('factsheet-range').click();
  await page.getByRole('option', { name: label, exact: true }).click();
}

test('日期範圍含成立以來／今年以來／近一年／自訂', async ({ page }) => {
  await openDialog(page);
  await page.getByTestId('factsheet-range').click();
  for (const label of ['成立以來', '今年以來', '近一年', '近六個月', '近三個月', '自訂區間']) {
    await expect(page.getByRole('option', { name: label, exact: true })).toBeVisible();
  }
  await page.keyboard.press('Escape');
});

test('今年以來只計入當年出場交易', async ({ page }) => {
  await openDialog(page);
  await expect(page.getByTestId('factsheet-preview-metrics')).toContainText('3 筆');
  await pickRange(page, '今年以來');
  await expect(page.getByTestId('factsheet-preview-metrics')).toContainText('2 筆');
  await expect(page.getByTestId('factsheet-period')).toContainText('今年以來');
});

test('自訂區間：有效範圍即時更新，無效範圍阻擋匯出', async ({ page }) => {
  await openDialog(page);
  await pickRange(page, '自訂區間');
  await expect(page.getByTestId('factsheet-custom-error')).toBeVisible();
  await expect(page.getByTestId('factsheet-export-confirm')).toBeDisabled();

  await page.getByTestId('factsheet-custom-start').fill('2026-01-01');
  await page.getByTestId('factsheet-custom-end').fill('2026-03-31');
  await expect(page.getByTestId('factsheet-custom-error')).toHaveCount(0);
  await expect(page.getByTestId('factsheet-preview-metrics')).toContainText('1 筆');
  await expect(page.getByTestId('factsheet-period')).toContainText('自訂區間 2026/01/01–2026/03/31');

  // 起日晚於迄日
  await page.getByTestId('factsheet-custom-start').fill('2026-06-01');
  await expect(page.getByTestId('factsheet-custom-error')).toContainText('起日不得晚於迄日');
  await expect(page.getByTestId('factsheet-export-confirm')).toBeDisabled();

  // 超出 DB 可用日期
  await page.getByTestId('factsheet-custom-start').fill('2026-01-01');
  await page.getByTestId('factsheet-custom-end').fill('2026-12-31');
  await expect(page.getByTestId('factsheet-custom-error')).toContainText('迄日不得晚於資料庫最後交易日');
});
