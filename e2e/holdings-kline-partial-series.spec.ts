// partial 日 K 版面回歸（根因：3491 只回 2 根時被 `i/(N-1)` 拉滿全寬 → 巨柱＋大空白）。
// 契約來源：src/checkup/lib/klineXScale.ts、src/checkup/lib/partialSeries.ts
import { test, expect, type Page } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';

const SYMBOL = '3491';

function bars(n: number) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const d = new Date(Date.UTC(2026, 7, 3 + i));
    out.push({
      date: d.toISOString().slice(0, 10),
      open: 1000, high: 1170, low: 950, close: 1100, volume: 1_200_000,
    });
  }
  return out;
}

async function openPartial(page: Page, n: number) {
  await page.addInitScript(() => {
    try {
      window.localStorage.clear();
      window.localStorage.setItem('checkup-coach-seen-v1', '1');
      window.localStorage.setItem('holdings-intro-video-seen-v2', '1');
      window.localStorage.setItem('lf.checkup.onboarded', '1');
      window.sessionStorage.setItem('holdings-intro-video-dismissed-session', '1');
    } catch {}
  });
  await page.route('**/checkup-sparkline', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        result: {
          [SYMBOL]: {
            ohlc: bars(n),
            closes: bars(n).map((b) => b.close),
            source: 'tpex_daily',
            complete: false,
            fetched_at: new Date().toISOString(),
          },
        },
      }),
    });
  });
  await gotoWithRetry(page, '/holding-checkup?demo=1', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.wb-hero-pnl-num', { state: 'visible', timeout: 40_000 });
  await page.getByText(SYMBOL, { exact: false }).first().click();
  await page.waitForSelector('[data-testid="kline-chart-surface"]', { timeout: 20_000 });
  await page.waitForTimeout(1200);
}

async function measure(page: Page) {
  return page.evaluate(() => {
    const s = document.querySelector('[data-testid="kline-chart-surface"]') as HTMLElement;
    const r = s.getBoundingClientRect();
    const candles = [...s.querySelectorAll('[data-testid="kline-candle"]')].map((e) => {
      const b = e.getBoundingClientRect();
      return { left: b.left - r.left, right: b.right - r.left, width: b.width, top: b.top - r.top, bottom: b.bottom - r.top };
    });
    const note = document.querySelector('[data-testid="holdings-partial-series-note"]');
    return {
      width: r.width,
      height: r.height,
      candles,
      noteText: note?.textContent?.trim() ?? null,
      noteCount: document.querySelectorAll('[data-testid="holdings-partial-series-note"]').length,
      hasMetrics: !!document.querySelector('[data-testid="holdings-volume-analysis"]'),
      markers: document.querySelectorAll('[data-testid="reversal-marker"]').length,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
}

for (const width of [1280, 390]) {
  for (const n of [1, 2]) {
    test(`partial ${n} 根日 K 不跑版 @${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1200 });
      const errors: string[] = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await openPartial(page, n);
      const m = await measure(page);

      expect(m.candles.length).toBe(n);

      // 1. K 棒寬度不因資料少而暴增：固定 30 slot 下每根約 chartWidth/30 * 0.6
      const slotPx = m.width / 29;
      for (const c of m.candles) {
        expect(c.width).toBeLessThanOrEqual(slotPx * 0.8 + 1);
        expect(c.width).toBeGreaterThan(0);
        expect(c.top).toBeGreaterThanOrEqual(-0.5);
        expect(c.bottom).toBeLessThanOrEqual(m.height + 0.5);
      }

      // 2. 靠右對齊：最新一根貼右緣，且左半邊不會被單獨一根佔住
      const rightMost = Math.max(...m.candles.map((c) => c.right));
      expect(m.width - rightMost).toBeLessThanOrEqual(slotPx);
      const leftMost = Math.min(...m.candles.map((c) => c.left));
      expect(leftMost).toBeGreaterThan(m.width * 0.7);

      // 3. 只有一條 partial 提示，且不再輸出均量／壓力／轉折判讀
      expect(m.noteCount).toBe(1);
      expect(m.noteText).toContain('日 K 資料暫時不完整');
      expect(m.noteText).toContain(`${n}/30`);
      expect(m.hasMetrics).toBe(false);
      expect(m.markers).toBe(0);

      // 4. 無水平溢出、無 console error
      expect(m.overflow).toBeLessThanOrEqual(0);
      expect(errors).toEqual([]);
    });
  }
}
