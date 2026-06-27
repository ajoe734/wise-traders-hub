// 持倉抽屜匯出選單 E2E：
//   - 1:1 IG PNG / 16:9 簡報 PNG 各自下載成功
//   - filename 含 ratio tag（1x1 / 16x9）
//   - dataURL 為 PNG 且 > 5KB（守門「不會截白」）
//   - 截圖期間 [data-export-host] mount，且渲染含浮水印 legendflow.tw
//   - 截圖完成後 [data-export-host] 從 DOM 移除
//
// 註：抽屜在 <1024px 視窗會被 CSS 隱藏，所以固定 desktop viewport。
import { test, expect, type Page } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';

const ROUTE = '/holding-checkup?demo=1';

async function setupDemo(page: Page) {
  await page.addInitScript(() => {
    try {
      // 提前關掉所有 onboarding / coach / 影片，避免擋到匯出 summary 點擊
      window.localStorage.setItem('checkup-coach-seen-v1', '1');
      window.localStorage.setItem('holdings-intro-video-seen-v2', '1');
      window.sessionStorage.setItem('holdings-intro-video-dismissed-session', '1');
      window.localStorage.setItem('checkup-onboarding-tour-v1', 'done');
    } catch {}
  });
}

/** 攔截 <a download> click，把 href 暫存到 window.__lf_export_downloads */
async function installDownloadInterceptor(page: Page) {
  await page.addInitScript(() => {
    (window as any).__lf_export_downloads = [];
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      if (this.download) {
        (window as any).__lf_export_downloads.push({ download: this.download, href: this.href });
        return; // 阻擋實際下載
      }
      return origClick.apply(this, arguments as any);
    };
  });
}

test.describe('Holdings export menu', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await setupDemo(page);
    await installDownloadInterceptor(page);
    await gotoWithRetry(page, ROUTE, { waitUntil: 'domcontentloaded' });
    // 等持倉卡 render
    await page.locator('.wb-card').first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.locator('.wb-card').first().click();
    // 抽屜內匯出 summary（aria-label="匯出"）
    await page.locator('summary[aria-label="匯出"]').first().waitFor({ state: 'visible', timeout: 10_000 });
  });

  async function runExport(page: Page, optionLabel: RegExp) {
    const beforeCount = await page.evaluate(() => (window as any).__lf_export_downloads.length);
    await page.locator('summary[aria-label="匯出"]').first().click();
    await page.getByRole('button', { name: optionLabel }).first().click();
    await expect.poll(
      async () => page.evaluate(() => (window as any).__lf_export_downloads.length),
      { timeout: 30_000 }
    ).toBeGreaterThan(beforeCount);
    const last = await page.evaluate(() => {
      const arr = (window as any).__lf_export_downloads;
      return arr[arr.length - 1];
    });
    return last as { download: string; href: string };
  }

  test('1:1 IG PNG 下載成功 + filename 含 1x1 + dataURL 非空', async ({ page }) => {
    const dl = await runExport(page, /1:1\s*IG/);
    expect(dl.download).toMatch(/1x1/);
    expect(dl.download.endsWith('.png')).toBe(true);
    expect(dl.href.startsWith('data:image/png;base64,')).toBe(true);
    // 守門：base64 內容長度應遠大於 1×1 透明 PNG（~120 chars）
    expect(dl.href.length).toBeGreaterThan(5_000);
    // 截圖結束後 portal 應清掉
    await expect(page.locator('[data-export-host]')).toHaveCount(0);
  });

  test('16:9 簡報 PNG 下載成功 + filename 含 16x9', async ({ page }) => {
    const dl = await runExport(page, /16:9/);
    expect(dl.download).toMatch(/16x9/);
    expect(dl.download.endsWith('.png')).toBe(true);
    expect(dl.href.startsWith('data:image/png;base64,')).toBe(true);
    expect(dl.href.length).toBeGreaterThan(5_000);
  });

  test('離屏匯出卡渲染含浮水印 legendflow.tw 與 variant 屬性', async ({ page }) => {
    // 攔截 toPng：在第一次被呼叫時把離屏 DOM 內容快照下來
    await page.evaluate(() => {
      (window as any).__lf_export_snapshots = [];
      const obs = new MutationObserver(() => {
        document.querySelectorAll('[data-export-host]').forEach((el) => {
          (window as any).__lf_export_snapshots.push({
            variant: el.getAttribute('data-export-variant'),
            html: (el as HTMLElement).innerText,
            cardVariant: el.querySelector('[data-export-card]')?.getAttribute('data-variant'),
          });
        });
      });
      obs.observe(document.body, { childList: true, subtree: true });
      (window as any).__lf_export_obs = obs;
    });

    await page.locator('summary[aria-label="匯出"]').first().click();
    await page.getByRole('button', { name: /1:1\s*IG/ }).first().click();

    await expect.poll(
      async () => page.evaluate(() => (window as any).__lf_export_snapshots.length),
      { timeout: 30_000 }
    ).toBeGreaterThan(0);

    const snaps = await page.evaluate(() => (window as any).__lf_export_snapshots);
    const sq = snaps.find((s: any) => s.variant === 'square' && s.cardVariant === 'square');
    expect(sq, 'square 離屏卡應 mount').toBeTruthy();
    expect(sq.html).toMatch(/legendflow/);
    expect(sq.html).toMatch(/DECISION/);
  });
});
