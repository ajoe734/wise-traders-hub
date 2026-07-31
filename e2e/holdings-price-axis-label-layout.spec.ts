// 價格軸幾何回歸：280–2560px 全斷點掃描。
// 守門三件事：
//   1. 三個標籤（成本／現價／目標）都在容器內、彼此不重疊
//   2. 現價圓點永遠是正圓、且完整落在軸容器內
//   3. 標籤與圓點水平不打架（圓點在軸線上、標籤在上下 lane）
import { test, expect, type Page } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';

const BREAKPOINTS = [
  280, 300, 320, 360, 375, 380, 390, 414, 430, 480,
  540, 600, 640, 768, 834, 900, 1024, 1180, 1280, 1440,
  1600, 1920, 2160, 2560,
];

const TOL = 0.5;

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
  await page.locator('[data-testid="holdings-price-axis"]').waitFor({ state: 'visible', timeout: 10_000 });
}

type Geometry = {
  container: { left: number; right: number; top: number; bottom: number };
  track: { left: number; right: number; top: number; bottom: number } | null;
  labels: Array<{ id: string; left: number; right: number; top: number; bottom: number; clipped: boolean }>;
  dots: Array<{ left: number; right: number; top: number; bottom: number; width: number; height: number }>;
};

async function readGeometry(page: Page): Promise<Geometry> {
  return page.locator('[data-testid="holdings-price-axis"]').evaluate((root) => {
    const rect = (el: Element) => {
      const b = el.getBoundingClientRect();
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
    };
    const track = root.querySelector('svg')?.parentElement ?? null;
    return {
      container: rect(root),
      track: track ? rect(track) : null,
      labels: Array.from(
        root.querySelectorAll<HTMLElement>('[data-testid^="holdings-price-axis-label-"]'),
      ).map((el) => ({
        id: el.dataset.testid as string,
        ...rect(el),
        clipped: el.scrollWidth - el.clientWidth > 1,
      })),
      dots: Array.from(
        root.querySelectorAll<HTMLElement>('[data-testid="holdings-price-axis-dot"]'),
      ).map((el) => {
        const b = el.getBoundingClientRect();
        return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height };
      }),
    };
  });
}

function overlaps(a: { left: number; right: number; top: number; bottom: number },
                  b: { left: number; right: number; top: number; bottom: number }) {
  return a.left < b.right - TOL && a.right > b.left + TOL && a.top < b.bottom - TOL && a.bottom > b.top + TOL;
}

for (const width of BREAKPOINTS) {
  test(`價格軸標籤與現價圓點不跑版 @ ${width}px`, async ({ page }) => {
    await openFirstDrawer(page, width);
    const geo = await readGeometry(page);

    // 1) 三個標籤存在
    expect(geo.labels.map((l) => l.id).sort()).toEqual([
      'holdings-price-axis-label-cost',
      'holdings-price-axis-label-price',
      'holdings-price-axis-label-target',
    ]);

    // 2) 標籤水平／垂直皆在容器內
    for (const l of geo.labels) {
      expect(l.left, `${l.id} 左側越界 @${width}`).toBeGreaterThanOrEqual(geo.container.left - TOL);
      expect(l.right, `${l.id} 右側越界 @${width}`).toBeLessThanOrEqual(geo.container.right + TOL);
      expect(l.bottom, `${l.id} 下緣越界 @${width}`).toBeLessThanOrEqual(geo.container.bottom + TOL);
      expect(l.top, `${l.id} 上緣越界 @${width}`).toBeGreaterThanOrEqual(geo.container.top - TOL);
    }

    // 3) 標籤互不重疊
    for (let i = 0; i < geo.labels.length; i += 1) {
      for (let j = i + 1; j < geo.labels.length; j += 1) {
        const a = geo.labels[i];
        const b = geo.labels[j];
        expect(overlaps(a, b), `${a.id} 與 ${b.id} 重疊 @${width}`).toBe(false);
    }

    // 2b) 字寬規則：標籤不得被水平截斷（長字串應改成兩行而非 ellipsis 吃字）
    for (const l of geo.labels) {
      expect(l.clipped, `${l.id} 文字被截斷 @${width}`).toBe(false);
    }
    }

    // 4) 現價圓點：正圓、尺寸固定、完整落在軌道內
    expect(geo.dots.length, `現價圓點缺失 @${width}`).toBeGreaterThanOrEqual(1);
    const trackBox = geo.track ?? geo.container;
    for (const dot of geo.dots) {
      expect(Math.abs(dot.width - dot.height), `圓點被拉扁 @${width}`).toBeLessThanOrEqual(0.5);
      expect(dot.width, `圓點尺寸異常 @${width}`).toBeGreaterThan(4);
      expect(dot.width, `圓點尺寸異常 @${width}`).toBeLessThanOrEqual(12);
      expect(dot.left, `圓點左側越界 @${width}`).toBeGreaterThanOrEqual(trackBox.left - TOL);
      expect(dot.right, `圓點右側越界 @${width}`).toBeLessThanOrEqual(trackBox.right + TOL);
      expect(dot.top, `圓點上緣越界 @${width}`).toBeGreaterThanOrEqual(trackBox.top - TOL);
      expect(dot.bottom, `圓點下緣越界 @${width}`).toBeLessThanOrEqual(trackBox.bottom + TOL);
    }

    // 5) 圓點不得被標籤蓋住
    for (const dot of geo.dots) {
      for (const l of geo.labels) {
        expect(overlaps(dot, l), `${l.id} 蓋住現價圓點 @${width}`).toBe(false);
      }
    }

    // 6) 軸容器本身不得橫向溢出抽屜
    const panelRight = await page
      .locator('[data-testid="holdings-detail-panel"]')
      .evaluate((el) => el.getBoundingClientRect().right);
    expect(geo.container.right, `價格軸溢出抽屜 @${width}`).toBeLessThanOrEqual(panelRight + TOL);
  });
}
