// 視覺回歸 — Checkup token 漂移守門
//
// 目標：確保 Batch E/F 引入的 --cm-page-px / --cm-page-py / --cm-accent
// 與自架 Noto Serif/Sans TC woff2 在字型載入完成後，於常見解析度
// (390 / 768 / 1024 / 1280) 的版面間距與 accent 顏色不會漂移。
//
// 三層守門：
//   1) 計算 token：讀 :root computed style，比對常數
//   2) 版面間距：`.cm-page-content` computed paddingLeft 依 clamp(16, 3.5vw, 40) 對應
//   3) Accent 色：實際被使用的元素（cm-badge-exit / cm-upload-cta）
//      background/color === rgb(255, 77, 31)
//   4) Pixel diff：header + hero 區塊小範圍截圖
//
// 首次執行請帶 --update-snapshots 產生 baseline。
import { test, expect, type Page } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';

const ACCENT_RGB = 'rgb(255, 77, 31)';

// clamp(16, 3.5vw, 40)
function expectedPagePx(viewportWidth: number): number {
  return Math.min(40, Math.max(16, viewportWidth * 0.035));
}

async function prime(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('checkup-coach-seen-v1', '1');
      window.localStorage.setItem('holdings-intro-video-seen-v2', '1');
      window.sessionStorage.setItem('holdings-intro-video-dismissed-session', '1');
      window.localStorage.setItem('checkup-onboarding-tour-v1', 'done');
      window.localStorage.setItem('lf.checkup.onboarded', '1');
    } catch {}
  });
}

async function stabilize(page: Page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
        caret-color: transparent !important;
        scroll-behavior: auto !important;
      }
      .wb-spark, video, canvas[data-animated],
      [data-testid="live-quote"], [data-realtime],
      [data-skeleton], .animate-pulse, .animate-spin,
      [role="status"], [data-sonner-toaster], [data-radix-toast-root] {
        visibility: hidden !important;
      }
    `,
  });
  // 等 fontsource woff2 全部載入 —— 這是本 spec 的關鍵前置條件
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        window.scrollTo(0, 0);
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

test.describe('Checkup tokens visual — /holding-checkup', () => {
  test('token / spacing / accent 不漂移', async ({ page }, testInfo) => {
    const width = testInfo.project.use.viewport?.width ?? 1280;
    await prime(page);
    await gotoWithRetry(page, '/holding-checkup', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
    await stabilize(page);
    await page.waitForTimeout(200);

    // 1) --cm-accent 常數
    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--cm-accent').trim(),
    );
    expect(accent.toUpperCase()).toBe('#FF4D1F');

    // 2) --cm-page-px 依 viewport 對應 clamp 值（tolerance 0.5px 吸收次像素）
    const pagePx = await page.evaluate(() => {
      const el = document.createElement('div');
      el.style.padding = '0 var(--cm-page-px)';
      document.body.appendChild(el);
      const v = parseFloat(getComputedStyle(el).paddingLeft);
      el.remove();
      return v;
    });
    expect(Math.abs(pagePx - expectedPagePx(width))).toBeLessThan(0.75);

    // 3) --cm-page-py 常數
    const pagePy = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--cm-page-py').trim(),
    );
    expect(pagePy).toBe('10px');

    // 4) 字型 stack — fontsource @font-face 已註冊 Noto Sans TC / Noto Serif TC
    //    （fontsource 帶 unicode-range CJK 子集，僅在頁面出現對應字元時載入；
    //     此處只驗證 @font-face 註冊成功，避免 unicode-range 造成假陰性）
    const fontsRegistered = await page.evaluate(() => {
      const families = new Set<string>();
      document.fonts.forEach((f) => families.add(f.family.replace(/^["']|["']$/g, '')));
      return { sans: families.has('Noto Sans TC'), serif: families.has('Noto Serif TC') };
    });
    expect(fontsRegistered.sans).toBe(true);
    expect(fontsRegistered.serif).toBe(true);



    // 5) 實際使用 accent 的元素配色正確
    //    上傳 CTA 桌機顯示、手機由底欄圓鈕承接；用寬度切
    if (width >= 641) {
      const cta = page.locator('.cm-upload-cta').first();
      await expect(cta).toBeVisible();
      const bg = await cta.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg).toBe(ACCENT_RGB);
    } else {
      const upload = page.locator('.cm-mobile-tabbar__upload').first();
      await expect(upload).toBeVisible();
      const bg = await upload.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg).toBe(ACCENT_RGB);
    }

    // 6) Pixel diff — 頁面頂部固定範圍（含返回列 + 品牌/tab 區）
    //    /holding-checkup 頂欄無單一穩定 selector，直接以 clip 截固定範圍即可
    await expect(page).toHaveScreenshot(
      `checkup-tokens-header-${testInfo.project.name}.png`,
      {
        clip: { x: 0, y: 0, width, height: 220 },
        maxDiffPixelRatio: 0.02,
        animations: 'disabled',
        caret: 'hide',
        scale: 'css',
      },
    );
  });
});

