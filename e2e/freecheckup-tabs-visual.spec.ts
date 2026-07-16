// FreeCheckup 主要分頁視覺回歸：Holdings / News / Daily / Events / Log / Research
//
// 目的：在清理 DemoBanner / DemoCTA / DEMO_TAB_NOTICE_COPY 等未使用資產後，
// 為 6 個核心 tab 建立像素級 baseline，未來任何 tab 內視覺漂移都會被 CI 抓到。
//
// 首次執行請帶 --update-snapshots 產生 baseline：
//   bunx playwright test e2e/freecheckup-tabs-visual.spec.ts --update-snapshots
//
// 三個斷點（375 手機 / 768 平板 / 1280 桌面）以 project 帶入。
import { test, expect, type Page } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';

const ROUTE = '/holding-checkup?demo=1';

const TABS = [
  { key: 'holdings',  label: '持倉' },
  { key: 'events',    label: /^行事曆/ },
  { key: 'news',      label: '事件分析' },
  { key: 'daily',     label: /^(收盤分析|分析中)/ },
  { key: 'research',  label: /^(深度研究|研究中)/ },
  { key: 'log',       label: '交易日誌' },
] as const;

async function prime(page: Page) {
  await page.addInitScript(() => {
    try {
      // 關掉會擋 first-fold 的 coach / intro modal
      window.localStorage.setItem('checkup-coach-seen-v1', '1');
      window.localStorage.setItem('holdings-intro-video-seen-v2', '1');
      window.localStorage.setItem('lf.checkup.onboarded', '1');
      window.localStorage.setItem('checkup-onboarding-tour-v1', 'done');
      window.sessionStorage.setItem('holdings-intro-video-dismissed-session', '1');
    } catch {}
  });
}

async function stabilize(page: Page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition: none !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        caret-color: transparent !important;
        scroll-behavior: auto !important;
      }
      html { scroll-behavior: auto !important; }
      .wb-spark, video, canvas[data-animated],
      [data-testid="live-quote"], [data-realtime],
      [data-skeleton], .animate-pulse, .animate-spin,
      [role="status"], [data-sonner-toaster], [data-radix-toast-root] {
        visibility: hidden !important;
      }
    `,
  });
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
  });
  await page.evaluate(async () => {
    const imgs = Array.from(document.images);
    await Promise.all(
      imgs.map((img) =>
        img.complete && img.naturalWidth > 0
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              img.addEventListener('load', () => resolve(), { once: true });
              img.addEventListener('error', () => resolve(), { once: true });
            }),
      ),
    );
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        window.scrollTo(0, 0);
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function switchToTab(page: Page, label: string | RegExp) {
  // 桌面 tab 為文字按鈕，手機底欄僅 4 格（不含 news/research/log）；
  // 這裡優先鎖桌面 header (.cm-desktop-tabs) 內的按鈕，若手機寬度找不到就退回全域搜尋。
  const desktopScope = page.locator('.cm-desktop-tabs');
  const desktopBtn = desktopScope.getByRole('button', { name: label });
  if (await desktopBtn.count()) {
    await desktopBtn.first().click();
    return;
  }
  await page.getByRole('button', { name: label }).first().click();
}

test.describe('FreeCheckup — 主要分頁視覺回歸', () => {
  test.beforeEach(async ({ page }) => {
    await prime(page);
    await gotoWithRetry(page, ROUTE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.wb-hero-pnl-num, [data-testid="holdings-workbench"], .cm-desktop-tabs', {
      state: 'visible',
      timeout: 30_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
  });

  for (const { key, label } of TABS) {
    test(`tab screenshot — ${key}`, async ({ page }, testInfo) => {
      // 手機寬度沒有 header tabs 時，也不強制切換（holdings/daily 由底欄；其餘由 ⋯ 更多），
      // 但 test 目的是「這個 tab 的內容視覺」，所以強制透過桌面 tab bar；
      // 若桌面 tab bar 隱藏（手機寬度），跳過該 project 執行。
      const desktopVisible = await page.locator('.cm-desktop-tabs').isVisible().catch(() => false);
      if (!desktopVisible && key !== 'holdings') {
        test.skip(true, '手機寬度不顯示桌面 tab bar，跳過非 holdings 分頁快照');
      }

      if (key !== 'holdings') {
        await switchToTab(page, label);
        await page.waitForTimeout(200);
      }
      await stabilize(page);
      await page.waitForTimeout(200);

      await expect(page).toHaveScreenshot(
        `freecheckup-${key}-${testInfo.project.name}.png`,
        {
          fullPage: false,
          maxDiffPixelRatio: 0.02,
          animations: 'disabled',
          caret: 'hide',
          scale: 'css',
        },
      );
    });
  }
});
