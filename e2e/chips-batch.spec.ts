// PR-11: fetchChipsBatch 統一端點 E2E
// 目標：確認 POST /tw-chips-detail 批次介面被正確呼叫，並回傳 results map。
import { test, expect } from '@playwright/test';

const CHIPS_ROUTE = '**/tw-chips-detail**';

function batchResponse(stockIds: string[]) {
  const results: Record<string, any> = {};
  for (const id of stockIds) {
    results[id] = {
      stock_id: id,
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
      },
      bsr_as_of: '2026-07-24',
      source: 'TWSE',
      fetched_at: new Date().toISOString(),
    };
  }
  return {
    results,
    errors: {},
    served_at: new Date().toISOString(),
  };
}

test.describe('fetchChipsBatch 統一端點', () => {
  test('批次呼叫 POST /tw-chips-detail 並解析 results', async ({ page }) => {
    let requestMethod = '';
    let requestBody: any = null;

    await page.route(CHIPS_ROUTE, async (route) => {
      requestMethod = route.request().method();
      requestBody = route.request().postDataJSON();
      const ids = requestBody?.stock_ids || ['2330'];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(batchResponse(ids)),
      });
    });

    await page.goto('/e2e/chips-batch?codes=2330,2317');
    await expect(page.getByTestId('batch-status')).toHaveAttribute('data-status', 'ready', { timeout: 10000 });

    expect(requestMethod).toBe('POST');
    expect(requestBody).toEqual({ stock_ids: ['2330', '2317'] });

    await expect(page.getByTestId('batch-returned')).toHaveAttribute('data-count', '2');
    await expect(page.getByTestId('batch-first-code')).toHaveText('2330');
    await expect(page.getByTestId('batch-has-bsr')).toHaveAttribute('data-value', 'true');
    await expect(page.getByTestId('batch-has-inst')).toHaveAttribute('data-value', 'true');
  });

  test('空清單不發出網路請求', async ({ page }) => {
    let requestCount = 0;
    await page.route(CHIPS_ROUTE, async (route) => {
      requestCount += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ results: {}, errors: {}, served_at: new Date().toISOString() }),
      });
    });

    await page.goto('/e2e/chips-batch?codes=AAPL,MSFT');
    await expect(page.getByTestId('batch-status')).toHaveAttribute('data-status', 'ready', { timeout: 5000 });
    expect(requestCount).toBe(0);
    await expect(page.getByTestId('batch-returned')).toHaveAttribute('data-count', '0');
  });
});
