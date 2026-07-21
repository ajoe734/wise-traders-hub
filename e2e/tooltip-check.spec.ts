import { test, expect } from '@playwright/test';
import { gotoWithRetry } from '../../e2e/helpers/navigation';

test('today delta tooltip is visible and readable', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('checkup-coach-seen-v1', '1');
      window.localStorage.setItem('holdings-intro-video-seen-v2', '1');
      window.localStorage.setItem('lf.checkup.onboarded', '1');
      window.localStorage.setItem('checkup-onboarding-tour-v1', 'done');
      window.sessionStorage.setItem('holdings-intro-video-dismissed-session', '1');
    } catch {}
  });
  await page.setViewportSize({ width: 390, height: 900 });
  await gotoWithRetry(page, '/holding-checkup-demo', { waitUntil: 'domcontentloaded' });
  const card = page.locator('.wb-card').first();
  await card.waitFor({ state: 'visible', timeout: 15000 });
  await card.click();
  const panel = page.locator('[data-testid="holdings-detail-panel"]').first();
  await panel.waitFor({ state: 'visible', timeout: 15000 });
  const delta = panel.locator('[data-testid="drawer-today-delta"]').first();
  if (!(await delta.count())) return test.skip(true, 'demo 無 todayPct');
  const info = panel.locator('[data-testid="drawer-today-delta-info"]').first();
  await info.waitFor({ state: 'visible', timeout: 5000 });
  await info.hover();
  await page.waitForTimeout(300);
  const tooltip = page.locator('text=今日漲跌幅（% 與金額）與下方 30 日走勢帶使用相同收盤價來源').first();
  await expect(tooltip).toBeVisible();
});
