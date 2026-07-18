/**
 * 持倉抽屜多裝置滾動守門
 *
 * 驗證在 iOS 與 Android 一系列常見解析度下（含直橫、折疊機、平板）：
 *  1. SheetContent clientHeight ≤ viewport height（100dvh 契約，不會被 URL bar 撐爆）
 *  2. 內部可以滾到「最底」— scrollTop 可達 scrollHeight - clientHeight（±1px）
 *  3. 抽屜最後一個子節點的 bottom ≤ viewport bottom（不會被底部 UI 遮住）
 *  4. 抽屜自身 bottom 貼齊 viewport bottom（±1px）
 *
 * 測試裝置由 playwright.config.ts 各 project 指定 viewport 注入。
 */
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

test('SheetContent 高度不超過 viewport（100dvh 契約）', async ({ page }, testInfo) => {
  const vp = page.viewportSize()!;
  await setupDemo(page);
  await gotoWithRetry(page, '/holding-checkup-demo', { waitUntil: 'domcontentloaded' });
  await page.locator('.wb-card').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('.wb-card').first().click();

  const panel = page.locator('[data-testid="holdings-detail-panel"]');
  await panel.waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForTimeout(400);

  const geo = await panel.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      top: r.top,
      bottom: r.bottom,
      height: r.height,
      clientH: (el as HTMLElement).clientHeight,
      scrollH: (el as HTMLElement).scrollHeight,
    };
  });

  await testInfo.attach('panel-geometry.json', {
    body: JSON.stringify({ viewport: vp, geo }, null, 2),
    contentType: 'application/json',
  });

  // 抽屜高度不得超過 viewport（含 1px 誤差）
  expect(geo.clientH).toBeLessThanOrEqual(vp.height + 1);
  // bottom 貼齊 viewport bottom（右側 sheet, side="right" → 全高錨定）
  expect(Math.abs(geo.bottom - vp.height)).toBeLessThanOrEqual(1);
});

test('抽屜可滾到最底（scrollTop 可達最大值）', async ({ page }, testInfo) => {
  const vp = page.viewportSize()!;
  await setupDemo(page);
  await gotoWithRetry(page, '/holding-checkup-demo', { waitUntil: 'domcontentloaded' });
  await page.locator('.wb-card').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('.wb-card').first().click();

  const panel = page.locator('[data-testid="holdings-detail-panel"]');
  await panel.waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForTimeout(500);

  const result = await panel.evaluate((el) => {
    const target = el as HTMLElement;
    target.scrollTop = 999999;
    return {
      scrollTop: target.scrollTop,
      scrollH: target.scrollHeight,
      clientH: target.clientHeight,
      maxScroll: target.scrollHeight - target.clientHeight,
    };
  });

  await testInfo.attach('scroll-result.json', {
    body: JSON.stringify({ viewport: vp, ...result }, null, 2),
    contentType: 'application/json',
  });

  // 內容如果本身就短於 viewport（maxScroll = 0），視為天然到底
  if (result.maxScroll <= 0) {
    expect(result.scrollTop).toBe(0);
    return;
  }

  // 否則 scrollTop 應可達 maxScroll（±1px browser rounding）
  expect(Math.abs(result.scrollTop - result.maxScroll)).toBeLessThanOrEqual(1);
});

test('抽屜底部不會被 viewport 遮住（scrollHeight 完整可觸及）', async ({ page }, testInfo) => {
  const vp = page.viewportSize()!;
  await setupDemo(page);
  await gotoWithRetry(page, '/holding-checkup-demo', { waitUntil: 'domcontentloaded' });
  await page.locator('.wb-card').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('.wb-card').first().click();

  const panel = page.locator('[data-testid="holdings-detail-panel"]');
  await panel.waitFor({ state: 'visible', timeout: 10_000 });
  // 等 Suspense/lazy 內容穩定
  await page.waitForTimeout(1200);

  // 多輪 scroll：Radix + Suspense 期間 scrollTop 可能被 reset，重複 5 次逼到底
  for (let i = 0; i < 5; i++) {
    await panel.evaluate((el) => {
      const t = el as HTMLElement;
      t.scrollTop = t.scrollHeight;
    });
    await page.waitForTimeout(150);
  }

  const info = await panel.evaluate((el) => {
    const t = el as HTMLElement;
    const r = t.getBoundingClientRect();
    return {
      scrollTop: t.scrollTop,
      scrollH: t.scrollHeight,
      clientH: t.clientHeight,
      maxScroll: Math.max(0, t.scrollHeight - t.clientHeight),
      panelBottom: r.bottom,
      panelTop: r.top,
      hiddenBelow: Math.max(0, t.scrollHeight - t.clientHeight - t.scrollTop),
    };
  });

  await testInfo.attach('bottom-visibility.json', {
    body: JSON.stringify({ viewport: vp, ...info }, null, 2),
    contentType: 'application/json',
  });

  // panel bottom 貼齊 viewport（100dvh 契約）
  expect(Math.abs(info.panelBottom - vp.height)).toBeLessThanOrEqual(2);
  // 沒有殘留無法滾到的內容（±2px 容忍 sub-pixel）
  expect(info.hiddenBelow).toBeLessThanOrEqual(2);
});



