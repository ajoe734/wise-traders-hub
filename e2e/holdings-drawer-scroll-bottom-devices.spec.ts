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

test('滾到底後最後一段實際內容落在 panel 可視範圍內', async ({ page }, testInfo) => {
  const vp = page.viewportSize()!;
  await setupDemo(page);
  await gotoWithRetry(page, '/holding-checkup-demo', { waitUntil: 'domcontentloaded' });
  await page.locator('.wb-card').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('.wb-card').first().click();

  const panel = page.locator('[data-testid="holdings-detail-panel"]');
  await panel.waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForTimeout(500);

  // 滾到底
  await panel.evaluate((el) => {
    (el as HTMLElement).scrollTop = 999999;
  });
  await page.waitForTimeout(200);

  const info = await panel.evaluate((el) => {
    const target = el as HTMLElement;
    const pRect = target.getBoundingClientRect();
    // 選 panel 直接 flow 子孫（跳過 absolute/fixed 定位如 Close 按鈕、tooltip、portal）
    // 找 scrollHeight 末端最靠近 scrollBottom 的可見 leaf
    const all = Array.from(target.querySelectorAll<HTMLElement>('*'));
    let deepest: { tag: string; bottom: number; top: number } | null = null;
    for (const node of all) {
      const style = window.getComputedStyle(node);
      if (style.position === 'absolute' || style.position === 'fixed') continue;
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const r = node.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // 必須在 panel 水平範圍內（排除跑到外面的浮動元素）
      if (r.right < pRect.left || r.left > pRect.right) continue;
      if (!deepest || r.bottom > deepest.bottom) {
        deepest = { tag: node.tagName.toLowerCase(), bottom: r.bottom, top: r.top };
      }
    }
    return {
      last: deepest,
      panelBottom: pRect.bottom,
      panelTop: pRect.top,
      scrollTop: target.scrollTop,
      scrollH: target.scrollHeight,
      clientH: target.clientHeight,
      maxScroll: target.scrollHeight - target.clientHeight,
    };
  });

  await testInfo.attach('bottom-visibility.json', {
    body: JSON.stringify({ viewport: vp, ...info }, null, 2),
    contentType: 'application/json',
  });

  expect(info.last).not.toBeNull();
  // 契約：滾到底之後，「最後一段內容 bottom」必須落在 panel bottom 之內（±2px）
  // 若超出 → 代表 scroll 卡住 / 底部被裁切 / 100dvh 契約失守
  expect(info.last!.bottom).toBeLessThanOrEqual(info.panelBottom + 2);
});

