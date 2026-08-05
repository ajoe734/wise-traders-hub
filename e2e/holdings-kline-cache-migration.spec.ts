import { test, expect } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';

const SYMBOL = '3491';
const bars = Array.from({ length: 64 }, (_, i) => {
  const date = new Date(Date.UTC(2026, 4, 4 + i));
  return {
    date: date.toISOString().slice(0, 10),
    open: 1000 + i, high: 1010 + i, low: 990 + i, close: 1005 + i, volume: 1_000_000 + i,
  };
});

test('既有 v2 兩根 cache 在新版 session 自動淘汰並以完整資料取代', async ({ page }) => {
  await page.addInitScript(({ oldPayload }) => {
    localStorage.clear();
    localStorage.setItem('checkup-coach-seen-v1', '1');
    localStorage.setItem('holdings-intro-video-seen-v2', '1');
    localStorage.setItem('lf.checkup.onboarded', '1');
    sessionStorage.setItem('holdings-intro-video-dismissed-session', '1');
    localStorage.setItem('lf.checkup.cache.sparkline.v2', oldPayload);
  }, { oldPayload: JSON.stringify({ legacy: { v: { ohlc: bars.slice(-2), complete: true }, t: Date.now() } }) });

  let calls = 0;
  await page.route('**/checkup-sparkline', async (route) => {
    calls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ result: { [SYMBOL]: {
        ohlc: bars, closes: bars.map((bar) => bar.close), source: 'tpex_daily',
        complete: true, barCount: bars.length, fetchedAt: new Date().toISOString(), tradeDate: bars.at(-1)?.date,
      } } }),
    });
  });

  await gotoWithRetry(page, '/holding-checkup?demo=1', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.wb-hero-pnl-num', { state: 'visible', timeout: 40_000 });
  await page.getByText(SYMBOL, { exact: false }).first().click();
  const surface = page.getByTestId('kline-chart-surface');
  await expect(surface).toHaveAttribute('data-bar-count', '30');
  await expect(page.getByTestId('kline-candle')).toHaveCount(30);
  await expect(page.getByTestId('holdings-volume-analysis')).toBeVisible();
  await expect(page.getByTestId('holdings-partial-series-note')).toHaveCount(0);

  const storage = await page.evaluate(() => ({
    old: localStorage.getItem('lf.checkup.cache.sparkline.v2'),
    current: localStorage.getItem('lf.checkup.cache.sparkline.v6'),
    migration: localStorage.getItem('lf.checkup.sparkline-migrated.v6'),
  }));
  expect(storage.old).toBeNull();
  expect(storage.current).not.toBeNull();
  expect(storage.migration).toBe('1');
  expect(calls).toBeGreaterThanOrEqual(1);
});