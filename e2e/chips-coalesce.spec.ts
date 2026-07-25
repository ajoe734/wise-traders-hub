// PR-10: 籌碼面 coalesced 徽章 E2E（UI-only 驗證；不強求真跨-isolate 觸發）
// 目標：透過 mock API 回傳 coalesced=true，確認 ChipsSection header 有 COALESCED 徽章。
import { test, expect } from '@playwright/test';

const CHIPS_ROUTE = '**/tw-chips-detail**';

function coalescedPayload() {
  return {
    stock_id: '2330',
    as_of: '2026-07-25',
    institutional: {
      d1: { foreign_net: 250_000, trust_net: 40_000, dealer_net: -5_000, total_net: 285_000, days_covered: 1 },
      d5: { foreign_net: 1_200_000, trust_net: 180_000, dealer_net: -20_000, total_net: 1_360_000, days_covered: 5 },
      d20: { foreign_net: 3_500_000, trust_net: 400_000, dealer_net: -80_000, total_net: 3_820_000, days_covered: 20 },
      d60: { foreign_net: -1_800_000, trust_net: 600_000, dealer_net: 100_000, total_net: -1_100_000, days_covered: 60 },
    },
    bsr: {
      d5: {
        top_buy: [{ broker_id: '9800', name: '元大-台北', net: 1_500_000 }],
        top_sell: [{ broker_id: '8560', name: '新光-城中', net: -1_200_000 }],
        concentration_ratio: 78,
      },
      d20: null,
      d60: null,
    },
    bsr_as_of: '2026-07-24',
    source: 'TWSE',
    fetched_at: new Date().toISOString(),
    coalesced: true,
  };
}

function plainPayload() {
  return { ...coalescedPayload(), coalesced: false };
}

test.describe('ChipsSection coalesced 徽章', () => {
  test('coalesced=true 顯示 COALESCED 徽章', async ({ page }) => {
    await page.route(CHIPS_ROUTE, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(coalescedPayload()),
      });
    });

    await page.goto('/e2e/chips-section?code=2330');
    await page.getByTestId('chips-section').waitFor();
    await expect(page.getByTestId('chips-coalesced-badge')).toHaveText(/COALESCED/i);
  });

  test('coalesced=false 不顯示徽章', async ({ page }) => {
    await page.route(CHIPS_ROUTE, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(plainPayload()),
      });
    });

    await page.goto('/e2e/chips-section?code=2330');
    await page.getByTestId('chips-section').waitFor();
    await expect(page.getByTestId('chips-coalesced-badge')).toHaveCount(0);
  });
});
