// 正式抽屜：目標價／PE／PB／PS 共用一條 NT$ 軸。
// 守門：四段切換唯一且可操作、目標價只在目標模式、無效尺明示「無法估算」且不畫區間、
// 有效尺的區間落在同一條軸內、560／390／380px 無水平溢出。
import { test, expect, type Page } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';

const WIDTHS = [1280, 768, 560, 390, 380];

async function openDrawer(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    localStorage.setItem('checkup-coach-seen-v1', '1');
    localStorage.setItem('holdings-intro-video-seen-v2', '1');
    localStorage.setItem('lf.checkup.onboarded', '1');
    localStorage.setItem('checkup-onboarding-tour-v1', 'done');
    sessionStorage.setItem('holdings-intro-video-dismissed-session', '1');
  });
  await gotoWithRetry(page, '/holding-checkup-demo', { waitUntil: 'domcontentloaded' });
  const card = page.locator('.wb-card').first();
  await card.waitFor({ state: 'visible', timeout: 15_000 });
  await card.click();
  await page.locator('[data-testid="holdings-price-axis"]').waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('[data-testid="valuation-band-skeleton"]').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});
}

for (const width of WIDTHS) {
  test(`四段估值尺切換 @ ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await openDrawer(page, width);
    const axis = page.locator('[data-testid="holdings-price-axis"]');
    const status = page.getByTestId('price-scale-status');

    for (const key of ['target', 'pe', 'pb', 'ps', 'target'] as const) {
      const btn = page.getByTestId(`price-scale-mode-${key}`);
      await expect(btn).toHaveCount(1);
      await btn.click();
      await expect(btn).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.price-scale-switch [aria-pressed="true"]')).toHaveCount(1);

      if (key === 'target') {
        await expect(status).toContainText(/目標價|尚無分析師目標價/);
        await expect(axis.getByTestId('ruler-band')).toHaveCount(0);
      } else {
        await expect(axis.locator('.price-spectrum-marker--target')).toHaveCount(0);
        const text = await status.innerText();
        const bands = axis.getByTestId('ruler-band');
        if (/無法估算/.test(text)) {
          await expect(bands).toHaveCount(0);
          expect(text).toContain('不畫假區間');
        } else if (/情境/.test(text)) {
          if (await bands.count()) {
            await expect(bands.first()).toHaveAttribute('data-key', key);
            const low = Number(await bands.first().getAttribute('data-low'));
            const high = Number(await bands.first().getAttribute('data-high'));
            expect(low).toBeGreaterThan(0);
            expect(high).toBeGreaterThanOrEqual(low);
          }
          expect(text).not.toMatch(/合理價/);
        }
      }

      const overflow = await page.evaluate(() => {
        const panel = document.querySelector('[data-testid="holdings-detail-panel"]') as HTMLElement | null;
        return {
          doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          panel: panel ? panel.scrollWidth - panel.clientWidth : 0,
        };
      });
      expect(overflow.doc, `document 溢出 @${width} ${key}`).toBeLessThanOrEqual(1);
      expect(overflow.panel, `抽屜溢出 @${width} ${key}`).toBeLessThanOrEqual(1);
    }
    expect(errors).toEqual([]);
  });
}
