import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { seedSession, installRoutes } from './helpers/supabase-mock';

/** 實際 Chromium 下載驗收：點「產生 PDF」→ 取得 download 事件與 PDF 檔頭。 */
const EXPERT = {
  id: '11111111-1111-4111-8111-111111111111', slug: 'sharkgu', name: '彥愷', role: 'mentor', status: 'active',
  is_test: false, avatar_url: null, created_at: '2026-01-01T00:00:00Z',
  starting_capital: 1_000_000, currency: 'TWD', asset_class: 'tw_stock',
  strategy_summary: '波段', description: null, style_tags: ['尊重趨勢'], markets: ['台股'],
};
const TRADES = [{
  id: 't1', instrument: '2330 台積電', entry_price: 100, exit_price: 130, current_price: null,
  quantity: 1000, entry_date: '2026-06-02', exit_date: '2026-07-10', pnl_percent: 30, status: 'closed',
}];

test('點擊產生 PDF → Chromium 觸發下載', async ({ page }) => {
  await seedSession(page, { id: 'admin-1', email: 'admin@e2e.local', role: 'company_admin' });
  await installRoutes(page, {
    rest: {
      profiles: () => ({ display_name: 'Admin', is_tester: false }),
      user_roles: () => [{ role: 'company_admin' }],
      experts: ({ url }) => ((url.searchParams.get('select') ?? '').includes('expert_plans')
        ? [{ ...EXPERT, expert_plans: [] }] : EXPERT),
      trade_records: () => TRADES,
      public_expert_state_active: () => ({ state: 'ready', withheld_count: 0, incomplete_count: 0, manual_review_count: 0 }),
    },
    functions: { 'authorize-pdf-export': () => ({ allowed: true }) },
  });
  await page.goto('/admin/sharkgu/performance');
  await page.getByTestId('factsheet-export-trigger').click();
  await expect(page.getByTestId('factsheet-export-dialog')).toBeVisible();
  const [download, authRequest] = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    page.waitForRequest((request) => request.url().includes('authorize-pdf-export') && request.method() === 'POST'),
    page.getByTestId('factsheet-export-confirm').click(),
  ]);
  expect(authRequest.postDataJSON()).toEqual({ export_type: 'factsheet', expert_id: EXPERT.id });
  expect(download.suggestedFilename()).toMatch(/^legendflow-sharkgu-factsheet-\d{8}\.pdf$/);
  const path = await download.path();
  if (!path) throw new Error('PDF download has no local path');
  const buf = readFileSync(path);
  expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(buf.byteLength).toBeGreaterThan(50_000);
  console.log('DOWNLOAD', download.suggestedFilename(), buf.byteLength);
});

for (const status of [401, 403, 500]) {
  test(`授權 ${status} 不下載且顯示後端原因並可重試`, async ({ page }) => {
    await seedSession(page, { id: 'owner-1', email: 'owner@e2e.local', role: 'analyst' });
    let denied = true;
    const downloads: string[] = [];
    page.on('download', (download) => downloads.push(download.suggestedFilename()));
    await installRoutes(page, {
      rest: {
        profiles: () => ({ display_name: 'Owner', expert_slug: 'sharkgu', is_tester: false }),
        user_roles: () => [{ role: 'analyst' }],
        experts: ({ url }) => ((url.searchParams.get('select') ?? '').includes('expert_plans')
          ? [{ ...EXPERT, user_id: 'owner-1', expert_plans: [] }] : { ...EXPERT, user_id: 'owner-1' }),
        trade_records: () => TRADES,
        public_expert_state_active: () => ({ state: 'ready' }),
      },
      functions: { 'authorize-pdf-export': () => denied
        ? { __status: status, body: { message: `測試授權拒絕 ${status}` } }
        : { allowed: true } },
    });
    await page.goto('/admin/sharkgu/performance');
    await page.getByTestId('factsheet-export-trigger').click();
    await page.getByTestId('factsheet-export-confirm').click();
    await expect(page.getByText(`匯出失敗：測試授權拒絕 ${status}`, { exact: true })).toBeVisible();
    expect(downloads).toEqual([]);
    await expect(page.getByTestId('factsheet-export-confirm')).toBeEnabled();
    denied = false;
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 45_000 }),
      page.getByTestId('factsheet-export-confirm').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  });
}
