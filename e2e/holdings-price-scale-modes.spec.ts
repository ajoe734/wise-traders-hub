// 正式抽屜：D 版疊列啞鈴，PE／PB／PS、前瞻、同業共用一條 NT$ 軸、不需切換。
// 守門：五列各一、無值列標「資料不足」且不畫點、現價橘線存在、各寬度無水平溢出。
import { test, expect, type Page } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';

const WIDTHS = [1280, 768, 560, 414, 390, 380, 320];

async function openDrawer(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    localStorage.setItem('checkup-coach-seen-v1', '1');
    localStorage.setItem('holdings-intro-video-seen-v2', '1');
    localStorage.setItem('lf.checkup.onboarded', '1');
    localStorage.setItem('checkup-onboarding-tour-v1', 'done');
    sessionStorage.setItem('holdings-intro-video-dismissed-session', '1');
  });
  await gotoWithRetry(page, '/holding-checkup-demo', { waitUntil: 'domcontentloaded' });
  const card = page.locator('.wb-card').first();
  await card.waitFor({ state: 'visible', timeout: 15_000 });
  await card.click();
  await page.locator('[data-testid="valuation-dumbbell"]').waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('[data-testid="valuation-band-skeleton"]').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});
}

for (const width of WIDTHS) {
  test(`估值疊列啞鈴 @ ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await openDrawer(page, width);
    const chart = page.getByTestId('valuation-dumbbell');
    await expect(page.locator('.price-scale-switch')).toHaveCount(0);
    for (const key of ['pe', 'pb', 'ps', 'forward', 'peer']) {
      const row = chart.getByTestId(`dumbbell-row-${key}`);
      await expect(row).toHaveCount(1);
      if ((await row.getAttribute('data-status')) === 'missing') {
        await expect(row.locator('circle')).toHaveCount(0);
        await expect(row).toContainText('資料不足');
      }
    }
    await expect(chart.getByTestId('dumbbell-price')).toHaveCount(1);
    await chart.getByTestId('dumbbell-row-ps').click();
    await expect(chart.getByTestId('dumbbell-selected')).toContainText('PS');
    const overflow = await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="holdings-detail-panel"]') as HTMLElement | null;
      return { doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, panel: panel ? panel.scrollWidth - panel.clientWidth : 0 };
    });
    expect(overflow.doc).toBeLessThanOrEqual(1);
    expect(overflow.panel).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
}
