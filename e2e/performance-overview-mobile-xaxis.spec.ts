/**
 * 手機版（390px）效能概覽 X 軸：
 *  - tick 數量 ≤ 8
 *  - 任兩相鄰 tick 水平距離 ≥ 20px（不重疊）
 *  - 頁面無水平 overflow
 *
 * 不接 supabase，純讀 ExpertProfile 公開頁 DOM。
 */
import { test, expect, type Page } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';

const SLUG = process.env.PERF_EXPERT_SLUG || 'sharkgu';

test.use({ viewport: { width: 390, height: 844 } });

async function assertAxis(page: Page) {
  const axis = page.locator('.recharts-xAxis').first();
  await axis.waitFor({ state: 'visible', timeout: 10_000 });

  const ticks = axis.locator('.recharts-cartesian-axis-tick');
  const count = await ticks.count();
  expect(count, `tick 數量過多：${count}`).toBeLessThanOrEqual(8);

  if (count >= 2) {
    const xs: number[] = [];
    for (let i = 0; i < count; i++) {
      const box = await ticks.nth(i).boundingBox();
      if (box) xs.push(box.x);
    }
    xs.sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i] - xs[i - 1], 'tick 重疊（< 20px）').toBeGreaterThanOrEqual(20);
    }
  }

  const overflow = await page.evaluate(() => {
    const d = document.documentElement;
    return { sw: d.scrollWidth, cw: d.clientWidth };
  });
  expect(overflow.sw).toBeLessThanOrEqual(overflow.cw + 1);
}

test.describe('PerformanceOverviewPanel @ 390px', () => {
  for (const tab of ['年績效', '月績效', '週績效'] as const) {
    test(`X 軸 tick 不過密：${tab}`, async ({ page }) => {
      await gotoWithRetry(page, `/expert/${SLUG}`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

      const trigger = page.getByRole('tab', { name: tab });
      if (await trigger.count()) {
        await trigger.first().click();
        await page.waitForTimeout(400);
      }
      await assertAxis(page);
    });
  }
});
