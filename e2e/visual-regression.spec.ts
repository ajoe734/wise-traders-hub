// 視覺回歸：Portal 與 /app 關鍵頁面在 7 個斷點（320/375/414/560/768/1023/1280）的快照比對。
//
// 受測頁面：
//   Portal（公開）：/, /pricing, /experts, /legal, /holding-checkup-demo
//   Auth：/auth/login, /auth/register
//   /app（未登入會 redirect 到 /auth/login，仍快照 login 結果，確保 guard 行為穩定）
//
// 首次執行請帶 --update-snapshots 產生 baseline：
//   bunx playwright test e2e/visual-regression.spec.ts --update-snapshots
//
// 後續 CI 跑同 spec 即可比對差異（toHaveScreenshot maxDiffPixelRatio 0.02）。
import { test, expect, type Page } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';

const PAGES = [
  { path: '/', name: 'portal-home' },
  { path: '/pricing', name: 'portal-pricing' },
  { path: '/experts', name: 'portal-experts' },
  { path: '/legal', name: 'portal-legal' },
  { path: '/holding-checkup-demo', name: 'portal-checkup-demo' },
  { path: '/auth/login', name: 'auth-login' },
  { path: '/auth/register', name: 'auth-register' },
  { path: '/app/explore', name: 'app-explore' },
  { path: '/app/subscriptions', name: 'app-subscriptions' },
  { path: '/app/account', name: 'app-account' },
] as const;

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

async function stabilize(page: Page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        caret-color: transparent !important;
      }
      /* 隱藏會抖動的元素：sparkline、video、即時報價 */
      .wb-spark, video, [data-testid="live-quote"], [data-realtime] {
        visibility: hidden !important;
      }
    `,
  });
}

test.describe('Visual regression — Portal & /app across breakpoints', () => {
  for (const { path, name } of PAGES) {
    test(`screenshot ${name} @ ${path}`, async ({ page }, testInfo) => {
      await prime(page);
      await gotoWithRetry(page, path, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
      await stabilize(page);
      await page.waitForTimeout(400);

      await expect(page).toHaveScreenshot(
        `${name}-${testInfo.project.name}.png`,
        {
          fullPage: false,
          maxDiffPixelRatio: 0.02,
          animations: 'disabled',
          caret: 'hide',
        },
      );
    });
  }
});
