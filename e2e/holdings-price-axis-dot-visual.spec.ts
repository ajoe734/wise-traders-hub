// 視覺回歸：直接對「圓點」element 做像素快照比對，
// 防止 SVG <circle> 回退 或 preserveAspectRatio="none" 造成的橢圓形變。
// 搭配 holdings-price-axis-dot-shape.spec.ts 的幾何斷言雙保險。
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
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'desktop-1280', width: 1280, height: 900 },
];

async function openPanel(page: Page, w: number, h: number) {
  await page.setViewportSize({ width: w, height: h });
  await setupDemo(page);
  await gotoWithRetry(page, '/holding-checkup-demo', { waitUntil: 'domcontentloaded' });
  await page.locator('.wb-card').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('.wb-card').first().click();
  await page
    .locator('[data-testid="holdings-detail-panel"]')
    .waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForTimeout(500);
}

for (const bp of BREAKPOINTS) {
  test(`PriceAxis 圓點像素快照 @ ${bp.name}`, async ({ page }, testInfo) => {
    await openPanel(page, bp.width, bp.height);

    const dot = page.locator('[data-testid="holdings-price-axis-dot"]').first();
    await expect(dot).toBeVisible();

    // 附上幾何診斷，失敗時可直接看到形變數據
    const box = await dot.boundingBox();
    await testInfo.attach(`priceaxis-dot-box-${bp.name}.json`, {
      body: JSON.stringify({ viewport: { w: bp.width, h: bp.height }, box }, null, 2),
      contentType: 'application/json',
    });

    // 像素快照：只截圓點本身，避免價格數字動態值造成 flake
    await expect(dot).toHaveScreenshot(`price-axis-dot-${bp.name}.png`, {
      maxDiffPixels: 60, // 允許 sub-pixel 抗鋸齒差異；仍能抓橢圓形變（面積數十像素以上）
      maxDiffPixelRatio: 0.15,
      animations: 'disabled',
      scale: 'css',
    });
  });

  test(`RangeBand 圓點像素快照 @ ${bp.name}`, async ({ page }, testInfo) => {
    await openPanel(page, bp.width, bp.height);

    const band = page.locator('[data-testid="holdings-range-band-dot"]').first();
    if (!(await band.count())) {
      testInfo.skip(true, 'range band dot 不存在（sparkline 資料缺失）— 跳過');
      return;
    }
    await expect(band).toBeVisible();

    const box = await band.boundingBox();
    await testInfo.attach(`rangeband-dot-box-${bp.name}.json`, {
      body: JSON.stringify({ viewport: { w: bp.width, h: bp.height }, box }, null, 2),
      contentType: 'application/json',
    });

    await expect(band).toHaveScreenshot(`range-band-dot-${bp.name}.png`, {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
      scale: 'css',
    });
  });
}
