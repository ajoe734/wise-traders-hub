import { test, expect, type Page } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';

const BREAKPOINTS = [280, 320, 360, 380, 390, 414, 768, 1280];

async function openFirstDrawer(page: Page, width: number) {
  await page.setViewportSize({ width, height: 844 });
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
  await page.locator('[data-testid="holdings-detail-panel"]').waitFor({ state: 'visible', timeout: 10_000 });
}

for (const width of BREAKPOINTS) {
  test(`價格軸三個標籤不重疊且不超出容器 @ ${width}px`, async ({ page }) => {
    await openFirstDrawer(page, width);
    const axis = page.locator('[data-testid="holdings-price-axis"]');
    const labels = axis.locator('[data-testid^="holdings-price-axis-label-"]');
    await expect(labels).toHaveCount(3);

    const geometry = await axis.evaluate((root) => {
      const container = root.getBoundingClientRect();
      const boxes = Array.from(root.querySelectorAll<HTMLElement>('[data-testid^="holdings-price-axis-label-"]'))
        .map((el) => ({ id: el.dataset.testid, box: el.getBoundingClientRect() }));
      return {
        container: { left: container.left, right: container.right },
        boxes: boxes.map(({ id, box }) => ({ id, left: box.left, right: box.right, top: box.top, bottom: box.bottom })),
      };
    });

    for (const box of geometry.boxes) {
      expect(box.left, `${box.id} 左側越界`).toBeGreaterThanOrEqual(geometry.container.left - 0.5);
      expect(box.right, `${box.id} 右側越界`).toBeLessThanOrEqual(geometry.container.right + 0.5);
    }
    for (let i = 0; i < geometry.boxes.length; i += 1) {
      for (let j = i + 1; j < geometry.boxes.length; j += 1) {
        const a = geometry.boxes[i];
        const b = geometry.boxes[j];
        const overlaps = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        expect(overlaps, `${a.id} 與 ${b.id} 不得重疊`).toBe(false);
      }
    }
  });
}