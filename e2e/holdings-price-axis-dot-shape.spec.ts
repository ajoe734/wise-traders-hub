// 防回歸：PriceAxis / RangeBand 圓點必須永遠是「正圓」，
// 不得再退回 SVG <circle> 導致被 preserveAspectRatio="none" 拉成扁橢圓。
import { test, expect, type Page } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';

async function setupDemo(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('checkup-coach-seen-v1', '1');
      window.localStorage.setItem('holdings-intro-video-seen-v2', '1');
      window.localStorage.setItem('lf.checkup.onboarded', '1');
      window.localStorage.setItem('checkup-onboarding-tour-v1', 'done');
      window.sessionStorage.setItem('holdings-intro-video-dismissed-session', '1');
    } catch {}
  });
}

const BREAKPOINTS = [
  { name: '390 (iPhone)', width: 390, height: 844 },
  { name: '768 (tablet)', width: 768, height: 1024 },
  { name: '1280 (desktop)', width: 1280, height: 900 },
];

for (const bp of BREAKPOINTS) {
  test(`圓點在 ${bp.name} 必須是正圓（不被 SVG 拉扁）`, async ({ page }) => {
    await page.setViewportSize({ width: bp.width, height: bp.height });
    await setupDemo(page);
    await gotoWithRetry(page, '/holding-checkup-demo', { waitUntil: 'domcontentloaded' });
    await page.locator('.wb-card').first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.locator('.wb-card').first().click();
    await page.locator('[data-testid="holdings-detail-panel"]').waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForTimeout(400);

    // PriceAxis 現價圓點
    const priceDot = page.locator('[data-testid="holdings-price-axis-dot"]').first();
    await expect(priceDot).toBeVisible();
    const pBox = await priceDot.boundingBox();
    expect(pBox).not.toBeNull();
    expect(Math.abs(pBox!.width - pBox!.height)).toBeLessThanOrEqual(0.5);
    expect(pBox!.width).toBeLessThanOrEqual(12);

    // 確認 SVG 內已無 <circle>（根因防守）
    const svgCircles = await page
      .locator('[data-testid="holdings-price-axis"] svg circle')
      .count();
    expect(svgCircles).toBe(0);

    // RangeBand 30D 圓點（如果 spark data 存在）
    const bandDot = page.locator('[data-testid="holdings-range-band-dot"]');
    if (await bandDot.count()) {
      const bBox = await bandDot.first().boundingBox();
      expect(bBox).not.toBeNull();
      expect(Math.abs(bBox!.width - bBox!.height)).toBeLessThanOrEqual(0.5);
    }
    const rangeCircles = await page
      .locator('[data-testid="holdings-range-band"] svg circle')
      .count();
    expect(rangeCircles).toBe(0);
  });
}

test('抽屜在 iOS 尺寸能滾到最底（100dvh 高度上限）', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 667 });
  await setupDemo(page);
  await gotoWithRetry(page, '/holding-checkup-demo', { waitUntil: 'domcontentloaded' });
  await page.locator('.wb-card').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('.wb-card').first().click();
  const panel = page.locator('[data-testid="holdings-detail-panel"]');
  await panel.waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForTimeout(500);

  const info = await panel.evaluate((el) => {
    const before = el.scrollTop;
    el.scrollTop = 999999;
    const after = el.scrollTop;
    return {
      scrollH: el.scrollHeight,
      clientH: el.clientHeight,
      maxScroll: after - before,
      canReachBottom: Math.abs(el.scrollHeight - el.clientHeight - after) <= 1,
    };
  });
  expect(info.clientH).toBeLessThanOrEqual(667);
  expect(info.canReachBottom).toBe(true);
});
