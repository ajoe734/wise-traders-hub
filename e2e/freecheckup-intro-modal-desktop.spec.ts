import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { navigateAndWaitForCardReady } from './helpers/navigation';

/**
 * 桌面 viewport 的 demo intro modal 抑制回歸：
 * 已在 localStorage/sessionStorage 寫入抑制 flag 時，/holding-checkup 首屏
 * 不得自動彈出介紹影片 modal，也不得掛出 <video>。
 *
 * 覆蓋 desktop-intro-modal-1280 / 1440 / 1920 三個桌面斷點。
 * 手機斷點（320/340/375/414）由 freecheckup-card.spec.ts 覆蓋。
 */

const ROUTE = '/holding-checkup';
const CARD_SELECTOR = '.holdings-card-grid .wb-card';

async function gotoFreeCheckup(
  page: Page,
  testInfo?: TestInfo,
  { suppressIntro = true }: { suppressIntro?: boolean } = {},
) {
  await page.addInitScript((suppress) => {
    try {
      window.localStorage.setItem('checkup-demo-mode', '1');
      if (suppress) {
        window.localStorage.setItem('holdings-intro-video-seen-v2', '1');
        window.sessionStorage.setItem('holdings-intro-video-dismissed-session', '1');
      } else {
        // 明確清除，避免瀏覽器殘留 flag 影響 auto-open 驗證
        window.localStorage.removeItem('holdings-intro-video-seen-v2');
        window.sessionStorage.removeItem('holdings-intro-video-dismissed-session');
      }
    } catch {}
  }, suppressIntro);

  await navigateAndWaitForCardReady(page, ROUTE, {
    cardSelector: CARD_SELECTOR,
    selectorTimeoutMs: 30_000,
    testInfo,
    healthCheck: async ({ page: p }) => {
      const cardCount = await p.locator(CARD_SELECTOR).count();
      if (cardCount < 1) return false;
      const errorBanner = await p.locator('[data-testid="error-boundary"], .error-boundary').count();
      return errorBanner === 0;
    },
  });
}

test.describe('FreeCheckup desktop — intro modal suppression', () => {
  test('demo intro modal 不會自動彈出（桌面 viewport / flag 已抑制）', async ({ page }, testInfo) => {
    await gotoFreeCheckup(page, testInfo);

    // 1) modal 完全不 mount
    await expect(
      page.locator('[data-testid="holdings-intro-modal"]'),
      `[${testInfo.project.name}] demo intro modal 應被 localStorage/sessionStorage flag 抑制`,
    ).toHaveCount(0);

    // 2) 首屏不應有 <video>（避免 element screenshot 撞到影片）
    await expect(
      page.locator('video'),
      `[${testInfo.project.name}] demo 首屏不應有 <video> element`,
    ).toHaveCount(0);

    // 3) 首張卡片可見且無 modal dialog 覆蓋
    await expect(page.locator(CARD_SELECTOR).first()).toBeVisible();
    await expect(
      page.locator('[role="dialog"][aria-modal="true"]'),
      `[${testInfo.project.name}] 首屏不應有 modal dialog`,
    ).toHaveCount(0);

    // 4) 守門 flag：未來 key 名變更會直接 fail
    const flags = await page.evaluate(() => ({
      seen: window.localStorage.getItem('holdings-intro-video-seen-v2'),
      dismissed: window.sessionStorage.getItem('holdings-intro-video-dismissed-session'),
    }));
    expect(flags.seen, 'localStorage flag holdings-intro-video-seen-v2 應為 "1"').toBe('1');
    expect(flags.dismissed, 'sessionStorage flag holdings-intro-video-dismissed-session 應為 "1"').toBe('1');
  });
});
