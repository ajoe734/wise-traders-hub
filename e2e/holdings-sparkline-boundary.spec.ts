/**
 * E2E · 持倉 sparkline 的台北 14:05 expected trade date 換日（Stage2 seam）
 *
 * 面板：/e2e/holdings-detail-panel-volume?stage2=1（DEV-only harness，
 * 掛載同一支 production `useSparklines` + 同一顆 `expectedTradeDateStore`）。
 * 對外握手全走 fake CheckupGateway，因此本 spec 不 route-intercept、
 * 也不對 production route 新增任何 header / query 控制。
 *
 * 驗收：
 *   1. 初始 14:04:59 → expected = 2026-08-25（前一交易日），記 baseline invoke 數。
 *   2. 同一 mount 跨到 14:05:01 → expected = 2026-08-26，invoke 恰 +1，
 *      且該次 body.codes 只有 TW subset（00878,2330,911616），US 一個都不能有。
 *   3. 再前進 +5m / +30m → 不得再增加（expected 沒變 ⇒ stable snapshot ⇒ 0 request）。
 */
import { test, expect, Page } from '@playwright/test';

const URL = '/e2e/holdings-detail-panel-volume?stage2=1';
const ROOT = '[data-testid="stage2-sparkline-harness"]';

async function attr(page: Page, name: string): Promise<string> {
  return (await page.locator(ROOT).getAttribute(name)) ?? '';
}

async function invokeCount(page: Page): Promise<number> {
  return Number(await attr(page, 'data-stage2-invoke-count'));
}

test.describe('holdings sparkline · 14:05 expected trade date boundary', () => {
  test('跨界只補 TW subset 一次，之後不再重打', async ({ page }) => {
    await page.goto(URL);
    await expect(page.locator(ROOT)).toBeVisible();

    // 1) baseline —— 時鐘釘在 14:04:59，expected 停在前一交易日
    await expect(page.locator(ROOT)).toHaveAttribute('data-stage2-calendar-ready', '1');
    await expect(page.locator(ROOT)).toHaveAttribute('data-stage2-expected-trade-date', '2026-08-25');
    await expect
      .poll(() => invokeCount(page), { timeout: 5000 })
      .toBeGreaterThan(0);
    // 讓首輪 request 完全收斂再取 baseline
    await page.waitForTimeout(600);
    const baseline = await invokeCount(page);

    // 2) 跨 14:05
    await page.getByTestId('stage2-advance-boundary').click();
    await expect(page.locator(ROOT)).toHaveAttribute('data-stage2-expected-trade-date', '2026-08-26');
    await expect.poll(() => invokeCount(page), { timeout: 5000 }).toBe(baseline + 1);

    const lastCodes = (await attr(page, 'data-stage2-last-codes')).split(',').filter(Boolean).sort();
    expect(lastCodes).toEqual(['00878', '2330', '911616']);
    expect(lastCodes).not.toContain('AMD');
    expect(lastCodes).not.toContain('SOXL');

    // 3) +5m / +30m 皆不得再增加
    await page.getByTestId('stage2-advance-5m').click();
    await page.waitForTimeout(600);
    expect(await invokeCount(page)).toBe(baseline + 1);

    await page.getByTestId('stage2-advance-30m').click();
    await page.waitForTimeout(600);
    expect(await invokeCount(page)).toBe(baseline + 1);
    await expect(page.locator(ROOT)).toHaveAttribute('data-stage2-expected-trade-date', '2026-08-26');
  });
});
