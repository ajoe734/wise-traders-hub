// 歷史轉折標記（marker）與「日 K 收盤確認狀態」的 E2E 驗收。
// fixture 走 preview-only harness（deterministic），真實 Demo 由
// e2e/holdings-demo-volume.spec.ts 與 Preview 人工驗收覆蓋。
import { test, expect, Page } from '@playwright/test';

async function openFixture(page: Page, fixture: string) {
  await page.goto(`/e2e/holdings-detail-panel-volume?count=1&fixture=${fixture}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('holdings-volume-analysis')).toBeVisible();
}

test.describe('K 棒歷史轉折標記', () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 390, height: 1000 }); });

  test('無訊號 fixture 不渲染任何 marker', async ({ page }) => {
    await openFixture(page, 'none');
    await expect(page.getByTestId('reversal-marker')).toHaveCount(0);
    await expect(page.getByTestId('holdings-volume-reversal')).toHaveCount(0);
  });

  test('四型態各自出現 marker，方向決定上下、狀態決定字形', async ({ page }) => {
    const cases = [
      { fx: 'hammer', kind: 'hammer', state: 'pending', glyph: '△' },
      { fx: 'bullish-engulf', kind: 'bullish_engulfing', state: 'pending', glyph: '△' },
      { fx: 'shooting', kind: 'shooting_star', state: 'pending', glyph: '▽' },
      { fx: 'bearish-engulf', kind: 'bearish_engulfing', state: 'pending', glyph: '▽' },
      { fx: 'hammer-confirmed', kind: 'hammer', state: 'confirmed', glyph: '▲' },
    ];
    for (const c of cases) {
      await openFixture(page, c.fx);
      const m = page.locator(`[data-testid="reversal-marker"][data-reversal-kind="${c.kind}"]`);
      await expect(m).toHaveCount(1);
      await expect(m).toHaveAttribute('data-reversal-state', c.state);
      await expect(m).toHaveText(c.glyph);
      const aria = await m.getAttribute('aria-label');
      expect(aria).toMatch(/\d{4}\/\d{2}\/\d{2}/);
      expect(aria).toMatch(/待確認|已確認/);
      expect(aria).toMatch(/[\d,]+\.\d{2}/);
      // 摘要最多一條
      await expect(page.getByTestId('holdings-volume-reversal')).toHaveCount(1);
    }
  });

  test('failed 標記弱化並明寫已失效，且不進摘要', async ({ page }) => {
    await openFixture(page, 'hammer-failed');
    const m = page.locator('[data-testid="reversal-marker"][data-reversal-state="failed"]');
    await expect(m).toHaveCount(1);
    await expect(m).toHaveText('✕');
    await expect(m).toHaveAttribute('aria-label', /已失效/);
    expect(Number(await m.evaluate((el) => getComputedStyle(el).opacity))).toBeLessThanOrEqual(0.4);
    await expect(page.getByTestId('holdings-volume-reversal')).toHaveCount(0);
  });

  test('marker 點擊 / 鍵盤 focus 顯示同一份 tooltip（含型態與確認條件）', async ({ page }) => {
    await openFixture(page, 'hammer');
    const marker = page.getByTestId('reversal-marker').first();
    await marker.click({ force: true });
    const tip = page.getByTestId('kline-tooltip');
    await expect(tip).toBeVisible();
    await expect(page.getByTestId('kline-tooltip-sig')).toHaveText(/低檔放量長下影 · 待確認 · 站上 [\d,.]+ 才確認/);
    const clickText = await tip.innerText();

    await marker.evaluate((el: HTMLElement) => el.blur());
    await page.keyboard.press('Escape');
    await expect(tip).toHaveCount(0);
    await marker.focus();
    await expect(tip).toBeVisible();
    expect(await tip.innerText()).toBe(clickText);
  });

  test('390px 無水平 overflow、console 無錯誤', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await openFixture(page, 'shooting');
    const ov = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
    }));
    expect(ov.sw).toBeLessThanOrEqual(ov.cw);
    expect(errors).toEqual([]);
  });
});

test.describe('日 K 收盤確認狀態', () => {
  test('舊交易日資料顯示「待來源確認 + 最後交易日」，不得寫已確認', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await openFixture(page, 'hammer');
    const st = page.getByTestId('drawer-close-status');
    await expect(st).toBeVisible();
    await expect(st).toHaveAttribute('data-final', 'false');
    await expect(st).toHaveText(/日 K 收盤 待來源確認 · 最後交易日 \d{4}\/\d{2}\/\d{2}/);
  });
});
