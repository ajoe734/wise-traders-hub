import { test, expect, Page } from '@playwright/test';

/**
 * 30 日走勢卡 · 量價分析互動與 RWD 驗收（真實 API 資料，禁止 mock volume）
 *
 * URL: /e2e/holdings-detail-panel-volume?count=1&live=2330,mock
 *   live=<code>  真實 checkup-sparkline 資料
 *   live=mock    合成資料（volume 一律 null）→ 無量空狀態
 */

const LIVE = '2330';

async function openHarness(page: Page, query: string) {
  await page.goto(`/e2e/holdings-detail-panel-volume?count=1&${query}`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('holdings-range-band')).toBeVisible();
}

async function waitLiveBars(page: Page) {
  await expect
    .poll(async () => Number(await page.locator('#drawer-volume-harness-root').getAttribute('data-volume-live-bars')), { timeout: 30_000 })
    .toBeGreaterThan(30);
  await expect.poll(async () => page.getByTestId('volume-bar').count(), { timeout: 30_000 }).toBeGreaterThan(20);
}

test.describe('走勢卡 · 量價分析', () => {
  test('三個斷點：完整卡片元素齊備、無水平 overflow、無 console error', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    const cases = [
      { name: 'desktop768', w: 1280, h: 900, q: `live=${LIVE}&width=desktop&maxw=768`, layout: 'row' },
      { name: 'mobile390', w: 390, h: 900, q: `live=${LIVE}`, layout: 'grid-2' },
      { name: 'mobile360', w: 360, h: 900, q: `live=${LIVE}`, layout: 'grid-2' },
    ];

    for (const c of cases) {
      await page.setViewportSize({ width: c.w, height: c.h });
      await openHarness(page, c.q);
      await waitLiveBars(page);

      // 標題 / K 線 / 量能副圖 / MA5 / 摘要數字 / 短判讀同時存在
      await expect(page.getByTestId('holdings-range-band')).toContainText('30 日走勢');
      expect(await page.getByTestId('kline-bar').count()).toBe(30);
      await expect(page.getByTestId('holdings-volume-chart')).toHaveAttribute('data-has-volume', '1');
      await expect(page.getByTestId('volume-ma5')).toBeAttached();
      await expect(page.getByTestId('holdings-volume-metrics')).toHaveAttribute('data-metric-count', '5');
      await expect(page.getByTestId('holdings-volume-summary')).toBeVisible();

      // metric 版面：桌機一行、手機 2 欄 grid
      await expect(page.getByTestId('holdings-volume-metrics')).toHaveAttribute('data-layout', c.layout);

      // K 線是主角：量能副圖高度 ≈ 總高 18–27%
      // （K 線高度自 72→92px 以容納頂端 safe inset，量圖絕對高度 22px 未被壓縮，故比例下修）
      const kh = (await page.getByTestId('kline-chart-surface').boundingBox())!.height;
      const vh = (await page.getByTestId('holdings-volume-chart').boundingBox())!.height;
      expect(vh).toBeGreaterThanOrEqual(22);
      expect(vh / (kh + vh)).toBeGreaterThan(0.18);
      expect(vh / (kh + vh)).toBeLessThan(0.27);


      // 短判讀最多兩行
      const sum = page.getByTestId('holdings-volume-summary-text');
      const lines = await sum.evaluate((el) => {
        const cs = getComputedStyle(el);
        return (el as HTMLElement).clientHeight / parseFloat(cs.lineHeight || '16');
      });
      expect(lines).toBeLessThanOrEqual(2.2);

      // 無水平 overflow
      const ov = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
      }));
      expect(ov.sw).toBeLessThanOrEqual(ov.cw);
    }

    expect(errors).toEqual([]);
  });

  test('壓力標籤不出界、不超出圖表範圍', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await openHarness(page, `live=${LIVE}`);
    await waitLiveBars(page);

    const band = page.getByTestId('holdings-range-band');
    const state = await band.getAttribute('data-zone-state');
    expect(['cluster', 'reference', 'broken', 'testing', 'none']).toContain(state);

    if (await page.getByTestId('resistance-zone-label').count()) {
      const label = page.getByTestId('resistance-zone-label');
      // 狀態不可只靠顏色：標籤必含可讀文字
      await expect(label).toContainText(/壓力|突破/);
      const lb = (await label.boundingBox())!;
      const cb = (await page.getByTestId('kline-chart-surface').boundingBox())!;
      expect(lb.x).toBeGreaterThanOrEqual(cb.x - 1);
      expect(lb.x + lb.width).toBeLessThanOrEqual(cb.x + cb.width + 1);
      expect(lb.y).toBeGreaterThanOrEqual(cb.y - 1);
      expect(lb.y + lb.height).toBeLessThanOrEqual(cb.y + cb.height + 1);
    }
  });

  test('hover 與鍵盤 focus 顯示同一份 tooltip（日期/OHLC/漲跌/量/MA5/MA20/相對量能）', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await openHarness(page, `live=${LIVE}`);
    await waitLiveBars(page);

    const surface = page.getByTestId('kline-chart-surface');
    await surface.focus();
    const tip = page.getByTestId('kline-tooltip');
    await expect(tip).toBeVisible();
    for (const key of ['date', 'oh', 'lc', 'chg', 'vol', 'ma5', 'ma20', 'rel']) {
      await expect(page.getByTestId(`kline-tooltip-${key}`)).toBeVisible();
    }
    const focusText = await tip.innerText();

    await page.keyboard.press('ArrowLeft');
    const prevText = await tip.innerText();
    expect(prevText).not.toBe(focusText);
    await page.keyboard.press('End');
    await expect.poll(async () => tip.innerText()).toBe(focusText);

    // hover 最後一根，內容需與鍵盤版本一致
    await page.mouse.move(5, 5);
    const box = (await surface.boundingBox())!;
    await page.mouse.move(box.x + box.width - 3, box.y + box.height / 2);
    await expect(tip).toBeVisible();
    expect(await tip.innerText()).toBe(focusText);
  });

  test('切換有量／無量標的：不殘留量柱、均量與壓力狀態', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await openHarness(page, `live=${LIVE},mock`);
    await waitLiveBars(page);

    const band = page.getByTestId('holdings-range-band');
    await expect(band).toHaveAttribute('data-has-volume', '1');
    const zoneBefore = await band.getAttribute('data-zone-state');
    const metricsBefore = await page.getByTestId('holdings-volume-metrics').innerText();

    await page.getByTestId('live-symbol-mock').click();
    await expect(band).toHaveAttribute('data-has-volume', '0');
    expect(await page.getByTestId('volume-bar').count()).toBe(0);
    expect(await page.getByTestId('volume-ma5').count()).toBe(0);
    await expect(page.getByTestId('holdings-volume-empty')).toBeVisible();
    // 無量狀態只保留一個提示 + 壓力，不堆 0/5、0/20、相對量能 —
    await expect(page.getByTestId('holdings-volume-metrics')).toHaveAttribute('data-metric-count', '1');
    const emptyMetrics = await page.getByTestId('holdings-volume-metrics').innerText();
    expect(emptyMetrics).not.toContain('相對量能');
    expect(emptyMetrics).not.toContain('20 日均量');
    expect(emptyMetrics).not.toBe(metricsBefore);

    await page.getByTestId(`live-symbol-${LIVE}`).click();
    await expect(band).toHaveAttribute('data-has-volume', '1');
    await expect(band).toHaveAttribute('data-zone-state', String(zoneBefore));
    await expect.poll(async () => page.getByTestId('holdings-volume-metrics').innerText()).toBe(metricsBefore);
  });
});
