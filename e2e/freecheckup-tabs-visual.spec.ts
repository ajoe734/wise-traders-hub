// FreeCheckup 主要分頁視覺回歸：Holdings / Daily / Events / Log
//
// 為什麼只有 4 個 tab：`/holding-checkup` 的 Monocle 版頂欄只暴露
// 持倉／收盤分析／事件／記錄 四個入口（見 FreeCheckup.jsx `TABS`）。
// 'news' / 'research' / 'trade' 仍是內部 tab 值，沒有 UI 入口，
// 因此不是可測的 seam，已從本 spec 移除（舊版對它們的按鈕點擊必定 timeout）。
//
// 決定性：demo 模式的價格與日期會隨載入時間浮動，會讓像素基準無限漂移。
// 這裡以「凍結時鐘 + 決定性 Math.random」把 demo 資料釘死，不改產品程式。
//
// 首次執行請帶 --update-snapshots 產生 baseline：
//   bunx playwright test e2e/freecheckup-tabs-visual.spec.ts --update-snapshots
//
// 三個斷點（375 手機 / 768 平板 / 1280 桌面）以 project 帶入。
import { test, expect, type Page } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';

const ROUTE = '/holding-checkup?demo=1';
/** 釘死的展示時間（台北 2026/07/31 12:00），確保 demo 日期與相對天數穩定。 */
const FIXED_NOW = new Date('2026-07-31T04:00:00.000Z');

const TABS = [
  { key: 'holdings', desktop: /^持倉/, mobile: '持倉' },
  { key: 'daily', desktop: /^(收盤分析|分析中)/, mobile: '收盤' },
  { key: 'events', desktop: /^事件/, mobile: '事件' },
  { key: 'log', desktop: /^記錄/, mobile: '記錄' },
] as const;

async function prime(page: Page) {
  await page.clock.setFixedTime(FIXED_NOW);
  await page.addInitScript(() => {
    try {
      // 關掉會擋 first-fold 的 coach / intro modal
      window.localStorage.setItem('checkup-coach-seen-v1', '1');
      window.localStorage.setItem('holdings-intro-video-seen-v2', '1');
      window.localStorage.setItem('lf.checkup.onboarded', '1');
      window.localStorage.setItem('checkup-onboarding-tour-v1', 'done');
      window.sessionStorage.setItem('holdings-intro-video-dismissed-session', '1');
    } catch {}
    // 決定性亂數：demo 價格浮動 ±1.5% 會讓損益數字每次載入都不同
    let seed = 0x2f6e2b1;
    Math.random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
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
      /* 報價同步提示是計時性的（demo 開場自動抓價），出現/消失會整頁位移 */
      [data-testid="refresh-status-banner"],
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

/**
 * 切換分頁。桌面（>=768）走 `.cm-desktop-tabs`；手機（375）該列 `display:none`，
 * 改走底欄 `.cm-mobile-tabbar`（持倉／收盤／＋／事件／記錄）。
 */
async function switchToTab(page: Page, tab: (typeof TABS)[number]) {
  const desktopTabs = page.locator('.cm-desktop-tabs');
  if (await desktopTabs.isVisible().catch(() => false)) {
    await desktopTabs.getByRole('button', { name: tab.desktop }).first().click();
    return;
  }
  const mobileBar = page.locator('.cm-mobile-tabbar');
  await expect(mobileBar).toBeVisible();
  await mobileBar.getByRole('button', { name: tab.mobile, exact: true }).first().click();
}

test.describe('FreeCheckup — 主要分頁視覺回歸', () => {
  test.beforeEach(async ({ page }) => {
    await prime(page);
    await gotoWithRetry(page, ROUTE, { waitUntil: 'domcontentloaded' });
    // 注意：不可用逗號 OR selector — Playwright 只判斷第一個命中元素，
    // 而 `.cm-desktop-tabs` 在 375 是 display:none，會讓等待必定 timeout。
    await page.waitForSelector('.wb-hero-pnl-num', { state: 'visible', timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
  });

  for (const tab of TABS) {
    test(`tab screenshot — ${tab.key}`, async ({ page }, testInfo) => {
      if (tab.key !== 'holdings') {
        await switchToTab(page, tab);
        await page.waitForTimeout(300);
      }
      await stabilize(page);
      await page.waitForTimeout(200);

      await expect(page).toHaveScreenshot(
        `freecheckup-${tab.key}-${testInfo.project.name}.png`,
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
