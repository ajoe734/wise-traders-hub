// RWD 防回歸：公開頁面在 320 / 375 / 414 / 560 / 768 / 1023 全部不能觸發橫向 scroll。
//
// 受測頁面（無需登入）：
//   - /                   首頁
//   - /holding-checkup-demo   demo 持倉看板
//
// 斷言：document.documentElement.scrollWidth <= clientWidth + 1
//
// 註：authenticated 路由（/app, /company/*, /checkout）目前不在公開覆蓋範圍；
//      由 view-as / live-smoke 等專屬 spec 處理。
import { test, expect, type Page } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';

const PAGES = ['/', '/holding-checkup-demo'] as const;

async function expectNoHScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    const d = document.documentElement;
    return { sw: d.scrollWidth, cw: d.clientWidth };
  });
  expect(
    overflow.sw,
    `橫向 scroll：scrollWidth(${overflow.sw}) > clientWidth(${overflow.cw})`,
  ).toBeLessThanOrEqual(overflow.cw + 1);
}

async function prime(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('checkup-coach-seen-v1', '1');
      window.localStorage.setItem('holdings-intro-video-seen-v2', '1');
      window.sessionStorage.setItem('holdings-intro-video-dismissed-session', '1');
      window.localStorage.setItem('checkup-onboarding-tour-v1', 'done');
    } catch {}
  });
}

test.describe('RWD: no horizontal scroll on public routes', () => {
  for (const path of PAGES) {
    test(`不觸發橫向 scroll @ ${path}`, async ({ page }) => {
      await prime(page);
      await gotoWithRetry(page, path, { waitUntil: 'domcontentloaded' });
      // 等 layout 穩定
      await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
      await page.waitForTimeout(300);
      await expectNoHScroll(page);
    });
  }
});
