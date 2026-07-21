/**
 * 視覺回歸：RangeBand 30 日走勢紅點必須永遠貼齊 polyline 最右端。
 *
 * 覆蓋兩層驗證：
 *   1. 幾何斷言 — 紅點中心 x ≈ 容器右緣（≥ 容器寬度 97%），
 *      y ≈ polyline 最後一點 y（誤差 ≤ 1.5px）。
 *   2. 像素快照 — 對整個 RangeBand 區塊做 pixel diff，捕捉任何位移。
 *
 * 對應 plan：`.lovable/plan.md`（RangeBand 紅點修法）。
 */
import { test, expect, type Page } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';

async function primeDemo(page: Page) {
  await page.addInitScript(() => {
    try {
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
        transition: none !important;
        caret-color: transparent !important;
      }
    `,
  });
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
  });
}

const BREAKPOINTS = [
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'desktop-1280', width: 1280, height: 900 },
];

async function openFirstDrawer(page: Page) {
  await primeDemo(page);
  await gotoWithRetry(page, '/holding-checkup-demo', { waitUntil: 'domcontentloaded' });
  const firstCard = page.locator('.wb-card').first();
  await firstCard.waitFor({ state: 'visible', timeout: 15_000 });
  await firstCard.scrollIntoViewIfNeeded();
  await firstCard.click();
  await page
    .locator('[data-testid="holdings-detail-panel"]')
    .first()
    .waitFor({ state: 'visible', timeout: 10_000 });
  await stabilize(page);
  await page.waitForTimeout(400);
}

for (const bp of BREAKPOINTS) {
  test.describe(`RangeBand 紅點貼齊末端 @ ${bp.name}`, () => {
    test.use({ viewport: { width: bp.width, height: bp.height } });

    test('紅點中心必須貼齊容器右緣且與 polyline 尾點對齊', async ({ page }, testInfo) => {
      await openFirstDrawer(page);

      const band = page.locator('[data-testid="holdings-range-band"]').first();
      const dot = band.locator('[data-testid="holdings-range-band-dot"]');
      const svg = band.locator('svg').first();

      if (!(await dot.count())) {
        testInfo.skip(true, 'range band 尾點不存在（sparkline 資料缺失）— 跳過');
        return;
      }

      await expect(dot).toBeVisible();

      // 幾何量測：紅點需貼齊 SVG 右緣、y 座標對齊 polyline 最後一點
      const geometry = await band.evaluate((root) => {
        const svgEl = root.querySelector('svg') as SVGSVGElement | null;
        const dotEl = root.querySelector(
          '[data-testid="holdings-range-band-dot"]',
        ) as HTMLElement | null;
        const poly = root.querySelector('polyline') as SVGPolylineElement | null;
        if (!svgEl || !dotEl || !poly) return null;

        const svgBox = svgEl.getBoundingClientRect();
        const dotBox = dotEl.getBoundingClientRect();

        // polyline 最後一點在 viewBox 100x30 座標系
        const pts = poly.getAttribute('points')?.trim().split(/\s+/) ?? [];
        const last = pts[pts.length - 1]?.split(',').map(Number) ?? [NaN, NaN];
        const lastVbY = last[1];
        // preserveAspectRatio="none" → viewBox Y 直接映射到 SVG px 高
        const lastPxY = svgBox.top + (lastVbY / 30) * svgBox.height;

        return {
          svgLeft: svgBox.left,
          svgRight: svgBox.right,
          svgWidth: svgBox.width,
          dotCenterX: dotBox.left + dotBox.width / 2,
          dotCenterY: dotBox.top + dotBox.height / 2,
          lastPxY,
        };
      });

      expect(geometry, 'geometry must be measurable').not.toBeNull();
      const g = geometry!;

      await testInfo.attach(`rangeband-alignment-${bp.name}.json`, {
        body: JSON.stringify(g, null, 2),
        contentType: 'application/json',
      });

      // x：紅點中心必須在容器右緣附近（容忍 ±2px，涵蓋圓點半徑取整）
      expect(
        Math.abs(g.dotCenterX - g.svgRight),
        `紅點中心 x=${g.dotCenterX} 必須貼齊 svg 右緣=${g.svgRight}`,
      ).toBeLessThanOrEqual(2);

      // 額外守門：紅點中心相對 SVG 寬度 ≥ 97%
      const ratio = (g.dotCenterX - g.svgLeft) / g.svgWidth;
      expect(ratio, `紅點相對位置=${ratio.toFixed(4)}，應 ≥ 0.97`).toBeGreaterThanOrEqual(0.97);

      // y：紅點中心必須對齊 polyline 尾點（誤差 ≤ 1.5px）
      expect(
        Math.abs(g.dotCenterY - g.lastPxY),
        `紅點 y=${g.dotCenterY} 應對齊 polyline 尾點 y=${g.lastPxY}`,
      ).toBeLessThanOrEqual(1.5);
    });

    test('RangeBand 區塊像素快照', async ({ page }, testInfo) => {
      await openFirstDrawer(page);
      const band = page.locator('[data-testid="holdings-range-band"]').first();
      const dot = band.locator('[data-testid="holdings-range-band-dot"]');
      if (!(await dot.count())) {
        testInfo.skip(true, 'range band 尾點不存在（sparkline 資料缺失）— 跳過');
        return;
      }
      await expect(band).toBeVisible();
      await expect(band).toHaveScreenshot(`range-band-${bp.name}.png`, {
        maxDiffPixelRatio: 0.02,
        animations: 'disabled',
        scale: 'css',
      });
    });
  });
}
