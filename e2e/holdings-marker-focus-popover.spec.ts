// 轉折 marker 聚焦互動 + tooltip popover 尺寸/避讓的回歸測試。
// fixture 走 preview-only harness（deterministic，保證命中 marker）。
import { test, expect, Page } from '@playwright/test';

async function open(page: Page, fixture = 'hammer') {
  await page.goto(`/e2e/holdings-detail-panel-volume?count=1&fixture=${fixture}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('holdings-volume-analysis')).toBeVisible();
}

const TIP = '[data-testid="kline-tooltip"]';

test.describe('轉折 marker 聚焦 + popover', () => {
  for (const vp of [{ w: 1280, h: 900, name: 'desktop' }, { w: 390, h: 900, name: 'mobile' }]) {
    test(`${vp.name} popover 尺寸受限、四邊不出界、無水平 overflow`, async ({ page }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await open(page);
      const marker = page.getByTestId('reversal-marker').first();
      await marker.hover({ force: true });
      const tip = page.locator(TIP);
      await expect(tip).toBeVisible();

      const box = (await tip.boundingBox())!;
      expect(box.width).toBeLessThanOrEqual(Math.min(240, vp.w - 24) + 1);
      expect(box.height).toBeLessThanOrEqual(170);
      expect(box.height).toBeGreaterThanOrEqual(60);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(vp.w);
      expect(box.y + box.height).toBeLessThanOrEqual(vp.h);

      // 內容不裁切
      const clipped = await tip.evaluate((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
      expect(clipped).toBe(false);

      // 五個資訊區塊都在
      for (const k of ['date', 'oh', 'lc', 'chg', 'vol', 'ma5', 'ma20', 'rel', 'sig']) {
        await expect(page.getByTestId(`kline-tooltip-${k}`)).toBeVisible();
      }

      const ov = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
      }));
      expect(ov.sw).toBeLessThanOrEqual(ov.cw);
    });
  }

  test('hover / focus / click 共用同一聚焦狀態：命中棒清楚、其餘退焦、marker 浮起', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page);
    const marker = page.getByTestId('reversal-marker').first();

    const readBars = () => page.evaluate(() => {
      const bars = Array.from(document.querySelectorAll('[data-testid="kline-bar"]'));
      return {
        total: bars.length,
        dim: bars.filter((b) => b.getAttribute('data-dim') === '1').length,
        focusOpacity: bars.filter((b) => b.getAttribute('data-dim') === '0').map((b) => getComputedStyle(b).opacity),
      };
    });

    expect((await readBars()).dim).toBe(0);

    await marker.hover({ force: true });
    await expect(marker).toHaveAttribute('data-focused', '1');
    const st = await readBars();
    expect(st.dim).toBe(st.total - 1);
    expect(st.focusOpacity.every((o) => Number(o) >= 0.95)).toBe(true);
    const dimStyle = () => page.evaluate(() => {
      const el = document.querySelector('[data-testid="kline-bar"][data-dim="1"]')!;
      const cs = getComputedStyle(el);
      return { opacity: Number(cs.opacity), filter: cs.filter };
    });
    await expect.poll(async () => (await dimStyle()).opacity).toBeLessThanOrEqual(0.4);
    expect((await dimStyle()).opacity).toBeGreaterThanOrEqual(0.2);
    expect((await dimStyle()).filter).toContain('blur');

    // marker 以 transform 浮起（不改版面）
    const tf = await marker.evaluate((el) => getComputedStyle(el).transform);
    expect(tf).not.toBe('none');
    const m = tf.match(/matrix\(([^)]+)\)/);
    expect(m).not.toBeNull();
    const parts = m![1].split(',').map(Number);
    expect(parts[0]).toBeGreaterThan(1.1); // scale
    await expect(page.locator(TIP)).toBeVisible();

    // pointer 離開 → 完全還原
    await page.mouse.move(5, 5);
    await expect(page.locator(TIP)).toHaveCount(0);
    await expect.poll(async () => (await readBars()).dim).toBe(0);
    await expect(marker).toHaveAttribute('data-focused', '0');

    // 鍵盤 focus → 同一 state；Escape 關閉並還原
    await marker.focus();
    await expect(page.locator(TIP)).toBeVisible();
    await expect.poll(async () => (await readBars()).dim).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await expect(page.locator(TIP)).toHaveCount(0);
    await expect.poll(async () => (await readBars()).dim).toBe(0);

    // click/tap → 同一 state
    await marker.click({ force: true });
    await expect(page.locator(TIP)).toBeVisible();
    await expect(marker).toHaveAttribute('data-focused', '1');
  });

  test('切換標的（fixture）時聚焦與 popover 完全還原', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page, 'hammer');
    await page.getByTestId('reversal-marker').first().click({ force: true });
    await expect(page.locator(TIP)).toBeVisible();

    await open(page, 'none');
    await expect(page.locator(TIP)).toHaveCount(0);
    await expect(page.getByTestId('reversal-marker')).toHaveCount(0);
    const dim = await page.locator('[data-testid="kline-bar"][data-dim="1"]').count();
    expect(dim).toBe(0);
  });

  test('空方 marker（高檔爆量長上影）也走同一聚焦與避讓', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await open(page, 'shooting');
    const marker = page.getByTestId('reversal-marker').first();
    await marker.hover({ force: true });
    const tip = page.locator(TIP);
    await expect(tip).toBeVisible();
    const box = (await tip.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y).toBeGreaterThanOrEqual(0);
  });
});
