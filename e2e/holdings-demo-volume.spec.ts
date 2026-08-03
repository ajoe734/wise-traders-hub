import { test, expect, Page } from '@playwright/test';

/**
 * 真實使用者路徑（非 harness）：/holding-checkup Demo → 3443 持倉細節 → 量價分析。
 * 走的是 useSparklines → checkup-sparkline 的真實 OHLCV 資料流。
 */

async function openDemo(page: Page) {
  await page.goto('/holding-checkup-demo', { waitUntil: 'domcontentloaded' });
  const onboarding = page.getByTestId('onboarding-demo-start');
  await onboarding.waitFor({ state: 'visible', timeout: 30_000 });
  await onboarding.click();
  await expect(page.getByTestId('holdings-hero')).toBeVisible({ timeout: 30_000 });
}

async function openStock(page: Page, code: string) {
  await page.getByTestId(`checkup-today-todo-${code}`).click();
  await expect(page.getByTestId('drawer-identity')).toBeVisible({ timeout: 30_000 });
}

async function closeDrawer(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('drawer-identity')).toHaveCount(0, { timeout: 15_000 });
}

async function expectRealVolume(page: Page) {
  await expect
    .poll(() => page.getByTestId('volume-bar').count(), { timeout: 45_000 })
    .toBe(30);
  await expect(page.getByTestId('volume-ma5')).toHaveCount(1);
  await expect(page.getByTestId('holdings-volume-empty')).toHaveCount(0);
  const metrics = page.getByTestId('holdings-volume-metrics');
  await expect(metrics).toContainText('今日量');
  await expect(metrics).toContainText('5 日均量');
  await expect(metrics).toContainText('20 日均量');
  await expect(metrics).toContainText('相對量能');
  await expect(page.getByTestId('holdings-volume-summary-text')).not.toBeEmpty();
}

test.describe('Demo 持倉抽屜 · 真實成交量', () => {
  test('3443 抽屜渲染 30 根量柱 + MA5 + 四項讀值，切換股票不殘留', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await openDemo(page);
    await openStock(page, '3443');
    await expectRealVolume(page);

    // 切到另一檔實際 Demo 股票再切回，確認沒有狀態錯置
    await closeDrawer(page);
    await openStock(page, '3017');
    await expect(page.getByTestId('drawer-identity')).toContainText('3017');
    await closeDrawer(page);
    await openStock(page, '3443');
    await expect(page.getByTestId('drawer-identity')).toContainText('3443');
    await expectRealVolume(page);

    // 無水平溢出
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
    expect(errors).toEqual([]);
  });
});
