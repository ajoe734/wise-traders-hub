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

async function gotoFreeCheckup(page: Page, testInfo?: TestInfo) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('checkup-demo-mode', '1');
      window.localStorage.setItem('holdings-intro-video-seen-v2', '1');
      window.sessionStorage.setItem('holdings-intro-video-dismissed-session', '1');
    } catch {}
  });

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

  test('清除 flag 後，demo intro modal 會重新自動彈出（auto-open regression guard）', async ({ page, browserName }, testInfo) => {
    // WebKit headless 缺 H.264 codec，<video autoplay muted> 掛載時整個 page 會 crash，
    // 這與 modal 邏輯無關；chromium/firefox 覆蓋此案例已足夠回歸守門。
    test.skip(browserName === 'webkit', 'WebKit headless crashes on autoplay <video>; covered by chromium/firefox');

    // 攔截 mp4 請求：WebKit headless 缺 H.264 codec，會在 decode 時 crash page。
    // 這裡我們只驗 modal 是否 mount，不需要真的播放影片。
    await page.route(/\.mp4(\?|$)/, (route) => route.fulfill({ status: 204, body: '' }));

    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('checkup-demo-mode', '1');
        window.localStorage.removeItem('holdings-intro-video-seen-v2');
        window.sessionStorage.removeItem('holdings-intro-video-dismissed-session');
        // 避免 <video autoplay> 觸發 media pipeline
        Object.defineProperty(HTMLMediaElement.prototype, 'play', {
          configurable: true,
          value: function () { return Promise.resolve(); },
        });
      } catch {}
    });

    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' });

    // 1) modal 應自動 mount 並可見
    const modal = page.locator('[data-testid="holdings-intro-modal"]');
    await expect(
      modal,
      `[${testInfo.project.name}] 清除抑制 flag 後 demo intro modal 應自動彈出`,
    ).toHaveCount(1, { timeout: 15_000 });
    await expect(modal).toBeVisible();

    // 2) a11y 屬性（webkit headless 對 attribute polling 偶有延遲，改用 evaluate 直接讀）
    const a11y = await modal.evaluate((el) => ({
      role: el.getAttribute('role'),
      ariaModal: el.getAttribute('aria-modal'),
    }));
    expect(a11y.role, 'modal 應為 role=dialog').toBe('dialog');
    expect(a11y.ariaModal, 'modal 應為 aria-modal=true').toBe('true');

    // 3) 內部應掛出 <video>
    await expect(
      page.locator('[data-testid="holdings-intro-modal"] video'),
      `[${testInfo.project.name}] modal 內應掛出 <video>`,
    ).toHaveCount(1);

    // 4) 守門：init 階段確實已清除 flag
    const flags = await page.evaluate(() => ({
      seen: window.localStorage.getItem('holdings-intro-video-seen-v2'),
      dismissed: window.sessionStorage.getItem('holdings-intro-video-dismissed-session'),
    }));
    expect(flags.seen, '初始應無 localStorage suppress flag').toBeNull();
    expect(flags.dismissed, '初始應無 sessionStorage suppress flag').toBeNull();
  });

  // ---- close/persist 行為（桌面）------------------------------------------------
  // 這三個 test 都需要 mount <video>，WebKit headless 缺 H.264 codec 會 crash，統一 skip。

  test('點 ✕ 關閉 → 只寫入 sessionStorage flag，reload 不會再自動開啟', async ({ page, browserName }, testInfo) => {
    test.skip(browserName === 'webkit', 'WebKit headless crashes on autoplay <video>');
    await page.route(/\.mp4(\?|$)/, (route) => route.fulfill({ status: 204, body: '' }));
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('checkup-demo-mode', '1');
        Object.defineProperty(HTMLMediaElement.prototype, 'play', {
          configurable: true, value: function () { return Promise.resolve(); },
        });
      } catch {}
    });

    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' });
    const modal = page.locator('[data-testid="holdings-intro-modal"]');
    await expect(modal).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: '關閉介紹影片' }).click();
    await expect(modal, `[${testInfo.project.name}] modal 應立即關閉`).toHaveCount(0);

    let flags = await page.evaluate(() => ({
      seen: window.localStorage.getItem('holdings-intro-video-seen-v2'),
      dismissed: window.sessionStorage.getItem('holdings-intro-video-dismissed-session'),
    }));
    expect(flags.dismissed, '關閉後應寫入 sessionStorage flag').toBe('1');
    expect(flags.seen, '單次關閉不應寫入 localStorage 永久 flag').toBeNull();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    await expect(
      modal,
      `[${testInfo.project.name}] reload 後 modal 不應再自動開啟（sessionStorage 抑制）`,
    ).toHaveCount(0);

    flags = await page.evaluate(() => ({
      seen: window.localStorage.getItem('holdings-intro-video-seen-v2'),
      dismissed: window.sessionStorage.getItem('holdings-intro-video-dismissed-session'),
    }));
    expect(flags.dismissed).toBe('1');
    expect(flags.seen).toBeNull();
  });

  test('點「不再顯示」→ localStorage + sessionStorage 皆寫入，reload 不會自動開啟', async ({ page, browserName }, testInfo) => {
    test.skip(browserName === 'webkit', 'WebKit headless crashes on autoplay <video>');
    await page.route(/\.mp4(\?|$)/, (route) => route.fulfill({ status: 204, body: '' }));
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('checkup-demo-mode', '1');
        Object.defineProperty(HTMLMediaElement.prototype, 'play', {
          configurable: true, value: function () { return Promise.resolve(); },
        });
      } catch {}
    });

    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' });
    const modal = page.locator('[data-testid="holdings-intro-modal"]');
    await expect(modal).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: '不再顯示介紹影片' }).click();
    await expect(modal).toHaveCount(0);

    let flags = await page.evaluate(() => ({
      seen: window.localStorage.getItem('holdings-intro-video-seen-v2'),
      dismissed: window.sessionStorage.getItem('holdings-intro-video-dismissed-session'),
    }));
    expect(flags.seen, '「不再顯示」應寫入 localStorage 永久 flag').toBe('1');
    expect(flags.dismissed, '「不再顯示」也應寫入 sessionStorage flag').toBe('1');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    await expect(
      modal,
      `[${testInfo.project.name}] reload 後 modal 不應再自動開啟（localStorage 永久抑制）`,
    ).toHaveCount(0);

    flags = await page.evaluate(() => ({
      seen: window.localStorage.getItem('holdings-intro-video-seen-v2'),
      dismissed: window.sessionStorage.getItem('holdings-intro-video-dismissed-session'),
    }));
    expect(flags.seen).toBe('1');
    expect(flags.dismissed).toBe('1');
  });

  test('點 backdrop 關閉 → 寫入 sessionStorage flag（closeSession 行為）', async ({ page, browserName }, testInfo) => {
    test.skip(browserName === 'webkit', 'WebKit headless crashes on autoplay <video>');
    await page.route(/\.mp4(\?|$)/, (route) => route.fulfill({ status: 204, body: '' }));
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('checkup-demo-mode', '1');
        Object.defineProperty(HTMLMediaElement.prototype, 'play', {
          configurable: true, value: function () { return Promise.resolve(); },
        });
      } catch {}
    });

    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' });
    const modal = page.locator('[data-testid="holdings-intro-modal"]');
    await expect(modal).toBeVisible({ timeout: 15_000 });

    const box = await modal.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + 5, box!.y + 5);
    await expect(modal).toHaveCount(0);

    const flags = await page.evaluate(() => ({
      seen: window.localStorage.getItem('holdings-intro-video-seen-v2'),
      dismissed: window.sessionStorage.getItem('holdings-intro-video-dismissed-session'),
    }));
    expect(flags.dismissed, 'backdrop click 應寫入 sessionStorage flag').toBe('1');
    expect(flags.seen, 'backdrop click 不應寫入 localStorage flag').toBeNull();
  });

  test('按 ESC 關閉 → 寫入 sessionStorage flag、reload 後不再自動開啟', async ({ page, browserName }, testInfo) => {
    test.skip(browserName === 'webkit', 'WebKit headless crashes on autoplay <video>');
    await page.route(/\.mp4(\?|$)/, (route) => route.fulfill({ status: 204, body: '' }));
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('checkup-demo-mode', '1');
        Object.defineProperty(HTMLMediaElement.prototype, 'play', {
          configurable: true, value: function () { return Promise.resolve(); },
        });
      } catch {}
    });

    await page.goto(ROUTE, { waitUntil: 'domcontentloaded' });
    const modal = page.locator('[data-testid="holdings-intro-modal"]');
    await expect(modal).toBeVisible({ timeout: 15_000 });

    await page.keyboard.press('Escape');
    await expect(modal, `[${testInfo.project.name}] ESC 應立即關閉 modal`).toHaveCount(0);

    let flags = await page.evaluate(() => ({
      seen: window.localStorage.getItem('holdings-intro-video-seen-v2'),
      dismissed: window.sessionStorage.getItem('holdings-intro-video-dismissed-session'),
    }));
    expect(flags.dismissed, 'ESC 應寫入 sessionStorage flag').toBe('1');
    expect(flags.seen, 'ESC 不應寫入 localStorage 永久 flag').toBeNull();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    await expect(
      modal,
      `[${testInfo.project.name}] reload 後 modal 不應再自動開啟（ESC 已寫入 session flag）`,
    ).toHaveCount(0);

    flags = await page.evaluate(() => ({
      seen: window.localStorage.getItem('holdings-intro-video-seen-v2'),
      dismissed: window.sessionStorage.getItem('holdings-intro-video-dismissed-session'),
    }));
    expect(flags.dismissed).toBe('1');
    expect(flags.seen).toBeNull();
  });
});
