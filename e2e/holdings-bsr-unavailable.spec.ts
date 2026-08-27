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

  test('390px：body 分塊 30+1、數字原值不被籌碼列覆蓋、terminal 不再發任何請求', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    const bodies: string[][] = [];
    const lateCalls: string[] = [];
    let watching = false;
    await page.route('**/functions/v1/**', async (route) => {
      const url = route.request().url();
      // 只計籌碼相關端點；traffic-ingest 是站台流量遙測，與 D4 回補無關。
      if (watching && /tw-chips|bsr|rest\/v1|rpc\//.test(url)) {
        lateCalls.push(`${url} :: ${route.request().postData() ?? ''}`.slice(0, 200));
      }
      const ids: string[] = route.request().postDataJSON()?.stock_ids || [];
      if (ids.length) bodies.push(ids);
      if (!/tw-chips-detail/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({
          results: Object.fromEntries((ids.length ? ids : [STOCK]).map((id) => [id, { ...terminalPayload(), stock_id: id }])),
          errors: {},
          served_at: new Date().toISOString(),
        }),
      });
    });

    // v4.3 §F1：RPC 走 /rest/v1/rpc/*，不在 functions/v1 pattern 內 —— 必須另外攔。
    await page.route('**/rest/v1/**', async (route) => {
      const url = route.request().url();
      if (watching) lateCalls.push(`${url} :: ${route.request().postData() ?? ''}`.slice(0, 200));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: '[]',
      });
    });

    // (a) 真實 body：31 檔 → 兩個 body，size 恰為 30 與 1
    const codes = Array.from({ length: 31 }, (_, i) => String(1101 + i));
    await page.goto(`/e2e/chips-batch?codes=${codes.join(',')}`);
    await expect(page.getByTestId('batch-status')).toHaveAttribute('data-status', 'ready', { timeout: 15000 });
    const sizes = bodies.map((b) => b.length).sort((a, b) => b - a);
    expect(sizes, `RED: 實際 body sizes=${sizes.join(',')}`).toEqual([30, 1]);
    expect(new Set(bodies.flat()).size).toBe(31);

    // (b) 卡片：raw lowercase 代號仍讀得到快取，數字原值不被籌碼列覆蓋
    bodies.length = 0;
    await page.goto(`/e2e/holding-card-harness?code=%2000637l%20`);
    const bsr = page.getByTestId('holding-card-bsr');
    await expect(bsr).toHaveAttribute('data-bsr-state', 'unavailable_unsupported', { timeout: 15000 });
    await expect(bsr).toContainText('籌碼資料暫時無法取得');
    expect(bodies[0], 'RED: 卡片送出的 body 未正規化為 00637L').toEqual(['00637L']);

    // v4.3 §F7：fixture 為 qty 1000 / cost 100 / price 110 → 現價 110、損益 +10,000 (10.00%)
    const pnl = page.getByTestId('card-pnl');
    await expect(pnl).toContainText('10.00%');
    await expect(pnl).toContainText('10,000');
    const price = page.getByTestId('card-price');
    await expect(price).toBeVisible();
    await expect(price).toContainText('110');
    const qtyAnchor = page.getByTestId('card-qty');
    await expect(qtyAnchor).toBeVisible();
    const row = page.getByTestId('card-bottom-row');
    await expect(row).toBeVisible();

    const rb = await row.boundingBox();
    const sb = await bsr.boundingBox();
    const qb = await qtyAnchor.boundingBox();
    const pb = await price.boundingBox();
    expect(rb && sb && qb && pb).toBeTruthy();
    expect(
      sb!.y >= rb!.y + rb!.height - 1,
      `RED: 籌碼列 (y=${sb!.y}) 疊在底部數字列 (bottom=${rb!.y + rb!.height}) 上`,
    ).toBe(true);
    // 左緣不得被切掉、右緣不得溢出 390px
    for (const [nm, b] of [['bsr', sb!], ['bottom-row', rb!], ['qty', qb!], ['price', pb!]] as const) {
      expect(b.x, `RED: ${nm} 左緣切出畫面 (x=${b.x})`).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, `RED: ${nm} 溢出 390px 視窗`).toBeLessThanOrEqual(390);
    }

    // (c) terminal control：狀態定案後 5 秒內不得再有任何 edge / RPC 呼叫
    watching = true;
    await page.waitForTimeout(5000);
    expect(lateCalls.length, `RED: terminal 後仍有籌碼回補請求：\n${lateCalls.join('\n')}`).toBe(0);
  });
});
