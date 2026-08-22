/**
 * Stage 3B / S3B-0 RED E2E — BSR 不支援時的誠實降級
 *
 * 契約（v4.1 §S3B-D）：
 *   1. provider terminal（bsr_provider_unsupported）時，籌碼區必須顯示「不支援」語義，
 *      並顯示最後可得資料日期；不得沿用三大法人的新鮮度、不得顯示同步中／回補按鈕。
 *   2. 卡片層（不開抽屜）就要有 holding-card-bsr 節點與 data-bsr-state。
 *   3. 可見持倉 31 檔時，最多 2 個 bounded batch 請求，代號聯集完整。
 *
 * Stage D 後預期 GREEN：canonical seg state / 卡片層 consumer / 每批 30 的 chunking 皆已實作。
 */
import { test, expect, Route } from '@playwright/test';

const CHIPS_ROUTE = '**/tw-chips-detail**';
const STOCK = '2330';

function terminalPayload() {
  return {
    stock_id: STOCK,
    as_of: '2026-08-21',
    as_of_lag_days: 0,
    institutional: {
      d1: { foreign_net: 100_000, trust_net: 0, dealer_net: 0, total_net: 100_000, days_covered: 1 },
      d5: null, d20: null, d60: null,
    },
    bsr: { d1: null, d5: null, d10: null, d20: null, d60: null },
    bsr_as_of: '2026-08-14',
    bsr_lag_weekdays: 5,
    bsr_freshness_status: 'unsupported',
    bsr_provider_state: 'terminal_provider_rejected',
    bsr_terminal_code: 'bsr_provider_unsupported',
    series: { institutional_daily: [], bsr_concentration: [] },
    source: 'TWSE',
    fetched_at: new Date().toISOString(),
  };
}

test.describe('Stage D · BSR 不支援的誠實降級', () => {
  test('籌碼分段顯示 unavailable_unsupported 並保留最後可得日期', async ({ page }) => {
    await page.route(CHIPS_ROUTE, (r: Route) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(terminalPayload()),
      }),
    );

    await page.goto(`/e2e/chips-section?code=${STOCK}`);
    await page.getByTestId('chips-section').waitFor();

    const bsr = page.getByTestId('chips-seg-bsr');
    await expect(bsr, 'RED: 分段狀態未支援 unavailable_unsupported')
      .toHaveAttribute('data-seg-state', 'unavailable_unsupported');
    await expect(bsr).toContainText('籌碼資料暫時無法取得');
    await expect(bsr, 'RED: terminal 時必須仍顯示最後可得日期 2026/08/14').toContainText('2026/08/14');

    // 三大法人的新鮮度不得被借用
    await expect(page.getByTestId('chips-seg-institutional')).toHaveAttribute('data-seg-state', 'fresh');

    // terminal 時不得出現回補入口 / 同步中
    await expect(bsr).not.toContainText('同步中');
    await expect(page.getByRole('button', { name: /回補/ })).toHaveCount(0);
  });

  test('卡片層（未開抽屜）就有 holding-card-bsr 狀態節點', async ({ page }) => {
    await page.route(CHIPS_ROUTE, (r: Route) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ results: { [STOCK]: terminalPayload() }, errors: {}, served_at: new Date().toISOString() }),
      }),
    );

    await page.goto(`/e2e/holding-card-harness?code=${STOCK}`);
    const node = page.getByTestId('holding-card-bsr');
    await expect(node, 'RED: 卡片層沒有 holding-card-bsr 節點（只有抽屜才是 consumer）').toHaveCount(1);
    await expect(node).toHaveAttribute('data-bsr-state', 'unavailable_unsupported');
    await expect(node).toContainText('籌碼資料暫時無法取得');
    await expect(node).toHaveAttribute('data-bsr-as-of', '2026-08-14');
  });

  test('31 檔可見持倉 → 2 個 bounded batch 請求且代號聯集完整', async ({ page }) => {
    const batches: string[][] = [];
    await page.route(CHIPS_ROUTE, async (route) => {
      const body = route.request().postDataJSON();
      const ids: string[] = body?.stock_ids || [];
      batches.push(ids);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({
          results: Object.fromEntries(ids.map((id) => [id, { ...terminalPayload(), stock_id: id }])),
          errors: {},
          served_at: new Date().toISOString(),
        }),
      });
    });

    const codes = Array.from({ length: 31 }, (_, i) => String(1101 + i));
    await page.goto(`/e2e/chips-batch?codes=${codes.join(',')}`);
    await expect(page.getByTestId('batch-status')).toHaveAttribute('data-status', 'ready', { timeout: 15000 });

    expect(
      batches.length,
      `RED: 31 檔應分 2 個請求，實得 ${batches.length}（sizes=${batches.map((b) => b.length).join(',')}）`,
    ).toBe(2);
    const union = new Set(batches.flat());
    expect(union.size, `RED: 代號聯集應為 31，實得 ${union.size}`).toBe(31);
    for (const b of batches) expect(b.length).toBeLessThanOrEqual(30);
  });
});
