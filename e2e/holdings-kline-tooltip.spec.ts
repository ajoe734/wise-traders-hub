// TDD seam 2：K 棒 hover / 觸控 tooltip 的互動行為（走 preview-only harness）
//   - 滑到某根 → 出現十字線 + tooltip，顯示該根日期與 OHLC
//   - 移到最右緣 → 顯示最後一根，且 tooltip 往左翻不超出容器
//   - 離開 → tooltip 消失
//   - 折線退回模式（OHLC 不足）→ 不出現 tooltip
import { test, expect, type Page } from '@playwright/test';

function encodeFixture(fx: unknown): string {
  const json = JSON.stringify(fx);
  const b64 = Buffer.from(json, 'utf8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function ohlcSeries(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const base = 100 + i;
    const day = String((i % 28) + 1).padStart(2, '0');
    return {
      date: `2026-07-${day}`,
      open: base,
      high: base + 2,
      low: base - 2,
      close: base + (i % 2 === 0 ? 1 : -1),
    };
  });
}

async function openHarness(page: Page, fx: unknown) {
  await page.goto(`/e2e/range-band-harness?d=${encodeFixture(fx)}`, { waitUntil: 'domcontentloaded' });
  const band = page.locator('[data-testid="holdings-range-band"]');
  await band.waitFor({ state: 'visible', timeout: 15_000 });
  return band;
}

test.describe('K 棒 tooltip 互動', () => {
  test.use({ viewport: { width: 900, height: 700 } });

  test('hover 顯示十字線與該根 OHLC，離開後消失', async ({ page }) => {
    const bars = ohlcSeries(30);
    const band = await openHarness(page, { price: 118, low: 96, high: 132, ohlc: bars, symbol: '2330' });
    await expect(band).toHaveAttribute('data-chart-mode', 'kline');

    const chart = band.locator('svg').first();
    const box = (await chart.boundingBox())!;
    // 對準第 10 根（index 9 / 29）
    const targetRatio = 9 / (bars.length - 1);
    await page.mouse.move(box.x + box.width * targetRatio, box.y + box.height / 2);

    const tooltip = page.locator('[data-testid="kline-tooltip"]');
    await expect(tooltip).toBeVisible();
    // 垂直線寬度為 0，Playwright 視為 hidden → 以存在性與座標斷言
    const crosshair = page.locator('[data-testid="kline-crosshair"]');
    await expect(crosshair).toHaveCount(1);
    expect(Number(await crosshair.getAttribute('x1'))).toBeCloseTo((9 / 29) * 100, 1);

    await expect(page.locator('[data-testid="kline-tooltip-date"]')).toHaveText('2026/07/10');
    await expect(tooltip).toContainText('開 109.00');
    await expect(tooltip).toContainText('高 111.00');
    await expect(tooltip).toContainText('低 107.00');
    await expect(tooltip).toContainText('收 108.00');

    // 離開圖表 → tooltip 收掉
    await page.mouse.move(box.x + box.width / 2, box.y + box.height + 120);
    await expect(tooltip).toHaveCount(0);
  });

  test('滑到最右緣顯示最後一根，且 tooltip 不超出容器右緣', async ({ page }) => {
    const bars = ohlcSeries(30);
    const band = await openHarness(page, { price: 118, low: 96, high: 132, ohlc: bars });

    const chart = band.locator('svg').first();
    const box = (await chart.boundingBox())!;
    await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2);

    const tooltip = page.locator('[data-testid="kline-tooltip"]');
    await expect(tooltip).toBeVisible();
    const last = bars[bars.length - 1];
    await expect(page.locator('[data-testid="kline-tooltip-date"]')).toHaveText(last.date.replace(/-/g, '/'));

    const tb = (await tooltip.boundingBox())!;
    expect(tb.x + tb.width).toBeLessThanOrEqual(box.x + box.width + 1);
  });

  test('觸控點擊也能叫出 tooltip', async ({ page }) => {
    const bars = ohlcSeries(30);
    const band = await openHarness(page, { price: 118, low: 96, high: 132, ohlc: bars });
    const box = (await band.locator('svg').first().boundingBox())!;

    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
    await page.mouse.down();
    await expect(page.locator('[data-testid="kline-tooltip"]')).toBeVisible();
    await page.mouse.up();
  });

  test('折線退回模式沒有 tooltip 與十字線', async ({ page }) => {
    const band = await openHarness(page, {
      price: 118,
      low: 96,
      high: 132,
      spark: Array.from({ length: 30 }, (_, i) => 100 + i),
    });
    await expect(band).toHaveAttribute('data-chart-mode', 'line');

    const box = (await band.locator('svg').first().boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
    await expect(page.locator('[data-testid="kline-tooltip"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="kline-crosshair"]')).toHaveCount(0);
  });
});
