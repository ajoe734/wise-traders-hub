// 30 日 K 線頂端安全區回歸：最高 wick／有效壓力區標籤／轉折 marker 都在 chart safe bounds 內，
// 且標籤與最高 K 棒至少 6px 間距（根因：y-scale 與壓力標籤沒有共同避讓，K 棒貼頂）。
// 契約來源：src/checkup/lib/klineLayout.ts
import { test, expect, type Page } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';

const SAFE_GAP = 6;
const TOP_INSET = 22;
const BOTTOM_INSET = 16;

async function openSymbol(page: Page, symbol: string) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('checkup-coach-seen-v1', '1');
      window.localStorage.setItem('holdings-intro-video-seen-v2', '1');
      window.localStorage.setItem('lf.checkup.onboarded', '1');
      window.sessionStorage.setItem('holdings-intro-video-dismissed-session', '1');
    } catch {}
  });
  await gotoWithRetry(page, '/holding-checkup?demo=1', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.wb-hero-pnl-num', { state: 'visible', timeout: 40_000 });
  await page.getByText(symbol, { exact: false }).first().click();
  await page.waitForSelector('[data-testid="kline-chart-surface"]', { timeout: 20_000 });
  await page.waitForTimeout(1500);
}

async function measure(page: Page) {
  return page.evaluate(() => {
    const s = document.querySelector('[data-testid="kline-chart-surface"]') as HTMLElement;
    const r = s.getBoundingClientRect();
    const rel = (b: DOMRect) => ({ top: b.top - r.top, bottom: b.bottom - r.top, left: b.left - r.left, right: b.right - r.left });
    const wicks = [...s.querySelectorAll('[data-testid="kline-wick"]')].map((e) => rel(e.getBoundingClientRect()));
    const candles = [...s.querySelectorAll('[data-testid="kline-candle"]')].map((e) => rel(e.getBoundingClientRect()));
    const markers = [...s.querySelectorAll('[data-testid="reversal-marker"]')].map((e) => rel(e.getBoundingClientRect()));
    const labelEl = s.querySelector('[data-testid="resistance-zone-label"]');
    return {
      height: r.height,
      width: r.width,
      wicks,
      candles,
      markers,
      label: labelEl ? rel(labelEl.getBoundingClientRect()) : null,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
}

for (const width of [1280, 390]) {
  test(`3017 K 線頂端不跑版 @${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1200 });
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await openSymbol(page, '3017');
    const m = await measure(page);

    expect(m.wicks.length).toBeGreaterThan(5);
    const topWick = Math.min(...m.wicks.map((b) => b.top));
    const botWick = Math.max(...m.wicks.map((b) => b.bottom));

    // 1. 價格 plot 落在 safe bounds 內（含 headroom / footroom）
    expect(topWick).toBeGreaterThanOrEqual(TOP_INSET - 1);
    expect(botWick).toBeLessThanOrEqual(m.height - BOTTOM_INSET + 1);
    for (const b of [...m.wicks, ...m.candles]) {
      expect(b.top).toBeGreaterThanOrEqual(-0.5);
      expect(b.bottom).toBeLessThanOrEqual(m.height + 0.5);
    }

    // 2. 壓力標籤在圖內、不越界、與最高 K 棒至少 6px
    if (m.label) {
      expect(m.label.top).toBeGreaterThanOrEqual(-0.5);
      expect(m.label.bottom).toBeLessThanOrEqual(m.height + 0.5);
      expect(m.label.right).toBeLessThanOrEqual(m.width + 0.5);
      expect(topWick - m.label.bottom).toBeGreaterThanOrEqual(SAFE_GAP - 0.5);
    }

    // 3. 轉折 marker 不被裁切
    for (const b of m.markers) {
      expect(b.top).toBeGreaterThanOrEqual(-0.5);
      expect(b.bottom).toBeLessThanOrEqual(m.height + 0.5);
    }

    // 4. 無水平溢出、無 console error
    expect(m.overflow).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });
}
