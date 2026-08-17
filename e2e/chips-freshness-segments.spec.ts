/**
 * E2E · H6 分段新鮮度
 *
 * 契約：三大法人 與 券商分點 是兩個獨立來源，必須各自顯示 as_of 與狀態。
 * 特別驗證：分點不可用時，不能被三大法人的新鮮度「借用」成看起來是新的。
 */
import { test, expect, Route } from '@playwright/test';

const STOCK = '2330';
const CHIPS_ROUTE = '**/tw-chips-detail**';

function payload(overrides: Record<string, any> = {}) {
  return {
    stock_id: STOCK,
    as_of: '2026-08-17',
    as_of_lag_days: 0,
    institutional: {
      d1: { foreign_net: 250_000, trust_net: 40_000, dealer_net: -5_000, total_net: 285_000, days_covered: 1 },
      d5: null,
      d20: null,
      d60: null,
    },
    bsr: { d1: null, d5: null, d10: null, d20: null, d60: null },
    bsr_as_of: '2026-08-14',
    bsr_lag_weekdays: 3,
    bsr_freshness_status: 'sync_failed',
    series: { institutional_daily: [], bsr_concentration: [] },
    source: 'TWSE',
    fetched_at: new Date().toISOString(),
    ...overrides,
  };
}

async function mock(page: any, body: any) {
  await page.route(CHIPS_ROUTE, (r: Route) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body),
    }),
  );
}

test.describe('H6 · 分段新鮮度', () => {
  test('法人新鮮、分點停更 → 兩段狀態互相獨立', async ({ page }) => {
    await mock(page, payload());
    await page.goto(`/e2e/chips-section?code=${STOCK}`);
    await page.getByTestId('chips-section').waitFor();

    const segs = page.getByTestId('chips-freshness-segments');
    await expect(segs).toBeVisible();

    const inst = page.getByTestId('chips-seg-institutional');
    await expect(inst).toHaveAttribute('data-seg-state', 'fresh');
    await expect(inst).toContainText('三大法人');
    await expect(inst).toContainText('2026/08/17');

    const bsr = page.getByTestId('chips-seg-bsr');
    await expect(bsr).toHaveAttribute('data-seg-state', 'unavailable_failed');
    await expect(bsr).toContainText('券商分點');
    await expect(bsr).toContainText('目前不可用');
  });

  test('分點完全無資料 → unavailable 且不顯示任何日期', async ({ page }) => {
    await mock(page, payload({ bsr_as_of: null, bsr_freshness_status: 'no_data', bsr_lag_weekdays: null }));
    await page.goto(`/e2e/chips-section?code=${STOCK}`);
    await page.getByTestId('chips-section').waitFor();

    const bsr = page.getByTestId('chips-seg-bsr');
    await expect(bsr).toHaveAttribute('data-seg-state', 'unavailable');
    await expect(bsr).toContainText('目前不可用（上游來源中止）');
    await expect(bsr).not.toContainText('2026/');
  });

  test('法人落後 → lagging；分點同步中 → syncing', async ({ page }) => {
    await mock(
      page,
      payload({ as_of: '2026-08-13', as_of_lag_days: 4, bsr_freshness_status: 'syncing' }),
    );
    await page.goto(`/e2e/chips-section?code=${STOCK}`);
    await page.getByTestId('chips-section').waitFor();

    await expect(page.getByTestId('chips-seg-institutional')).toHaveAttribute('data-seg-state', 'lagging');
    await expect(page.getByTestId('chips-seg-institutional')).toContainText('落後 4 日');
    const bsr = page.getByTestId('chips-seg-bsr');
    await expect(bsr).toHaveAttribute('data-seg-state', 'syncing');
    await expect(bsr).toContainText('同步中');
  });

  test('FRESH 徽章明示為請求時間而非資料日期', async ({ page }) => {
    await mock(page, payload());
    await page.goto(`/e2e/chips-section?code=${STOCK}`);
    await page.getByTestId('chips-section').waitFor();
    const badge = page.getByTestId('chips-fresh-badge');
    if (await badge.count()) {
      await expect(badge).toHaveAttribute('title', /非資料日期/);
    }
  });
});
