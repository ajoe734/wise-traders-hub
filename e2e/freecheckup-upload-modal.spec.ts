import { test, expect, type Page } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';

/**
 * Batch C §6.3 / C2 回歸測試：
 *   1. 上傳 CTA（桌面右上 / 手機底欄中央「＋」）→ 開啟 TradeUploadModal
 *   2. ESC / 背景 / 「×」三條關閉路徑均可用
 *   3. Modal 開啟時不得產生橫向 scroll、body 應鎖 overflow:hidden
 *   4. DailyTab / LogTab 切換不破版（無橫向 scroll、關鍵區塊可見、無 console error）
 *
 * 目的：防止未來重構把 uploadModalOpen / setTab('trade') 或內部視覺編輯化搞回歸。
 */

const ROUTE = '/holding-checkup?demo=1';
const CLEAR_GUARD = '__lf_upload_modal_e2e_cleared';

async function setupCleanDemoOnce(page: Page) {
  await page.addInitScript((guardKey: string) => {
    try {
      if (window.localStorage.getItem(guardKey)) return;
      window.localStorage.setItem(guardKey, '1');
      window.localStorage.removeItem('holdings-intro-video-seen-v2');
      window.localStorage.removeItem('checkup-coach-seen-v1');
      window.localStorage.setItem('lf.checkup.onboarded', '1');
      window.sessionStorage.setItem('holdings-intro-video-dismissed-session', '1');
    } catch {}
  }, CLEAR_GUARD);
}

async function gotoDemo(page: Page) {
  await setupCleanDemoOnce(page);
  await gotoWithRetry(page, ROUTE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.wb-hero-pnl-num', { state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(400);
}

async function expectNoHorizontalScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => {
    const el = document.documentElement;
    return { scrollW: el.scrollWidth, clientW: el.clientWidth };
  });
  expect(
    overflow.scrollW,
    `${label}: scrollWidth=${overflow.scrollW} clientWidth=${overflow.clientW}`,
  ).toBeLessThanOrEqual(overflow.clientW + 1);
}

function collectConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err?.message || err)));
  return errors;
}

test.describe('TradeUploadModal — desktop 1280', () => {
  test('桌面「＋ 上傳」CTA 打開 modal，ESC / 背景 / × 三條路徑均可關閉', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const errors = collectConsoleErrors(page);
    await gotoDemo(page);

    const cta = page.getByTestId('checkup-upload-cta');
    await expect(cta).toBeVisible();

    // --- 1. 點 CTA 開啟 modal ---
    await cta.click();
    const modal = page.getByTestId('trade-upload-modal');
    await expect(modal).toBeVisible();
    // body overflow lock
    const bodyOverflow = await page.evaluate(() => document.body.style.overflow);
    expect(bodyOverflow).toBe('hidden');
    await expectNoHorizontalScroll(page, 'modal 開啟後桌面');

    // --- 2. ESC 關閉 ---
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');

    // --- 3. 再開，點 × 關閉 ---
    await cta.click();
    await expect(modal).toBeVisible();
    await modal.getByRole('button', { name: '關閉', exact: true }).click();
    await expect(modal).toHaveCount(0);

    // --- 4. 再開，點背景遮罩關閉（點 modal 外緣座標） ---
    await cta.click();
    await expect(modal).toBeVisible();
    // 點右上角遮罩空白處
    await page.mouse.click(20, 20);
    await expect(modal).toHaveCount(0);

    expect(errors.filter((e) => !/ResizeObserver|Non-Error promise|traffic-ingest|CORS|ERR_FAILED|Failed to load resource|\[TradeTab\]/i.test(e))).toEqual([]);
  });
});

test.describe('TradeUploadModal — mobile 390', () => {
  test('手機底欄「＋」CTA 打開 modal 且不破版', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const errors = collectConsoleErrors(page);
    await gotoDemo(page);

    const cta = page.getByTestId('checkup-upload-cta-mobile');
    await expect(cta).toBeVisible();
    await cta.click();

    const modal = page.getByTestId('trade-upload-modal');
    await expect(modal).toBeVisible();
    await expectNoHorizontalScroll(page, 'modal 開啟後手機');

    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);

    expect(errors.filter((e) => !/ResizeObserver|Non-Error promise|traffic-ingest|CORS|ERR_FAILED|Failed to load resource|\[TradeTab\]/i.test(e))).toEqual([]);
  });
});

test.describe('DailyTab / LogTab 切換 — 不破版回歸', () => {
  test('桌面：holdings → 收盤分析 → 記錄 → holdings，每步驟無橫向 scroll、關鍵內容可見', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const errors = collectConsoleErrors(page);
    await gotoDemo(page);
    await expectNoHorizontalScroll(page, 'holdings 初始');

    // → 收盤分析（DailyTab）
    await page.getByRole('button', { name: /^收盤分析$/ }).first().click();
    await expect(page.getByText(/今日總結|AI 策 略 分 析|事件連動/).first()).toBeVisible({ timeout: 5000 });
    await expectNoHorizontalScroll(page, 'daily');
    // C2：不得殘留 emoji ▶ 或 teal 舊色（顏色以類名或 hex 難精確；至少檢查 ▶ 已被替換為 ›/—）
    const daily = await page.locator('main, body').first().textContent();
    expect(daily || '').not.toMatch(/▶/);

    // → 記錄（LogTab）
    await page.getByRole('button', { name: /^記錄$/ }).first().click();
    await expect(page.getByText(/液冷|CoWoS|為什麼買進|止損|復盤|教訓/).first()).toBeVisible({ timeout: 5000 });
    await expectNoHorizontalScroll(page, 'log');
    const log = await page.locator('main, body').first().textContent();
    expect(log || '').not.toMatch(/▶/);

    // → 回持倉
    await page.getByRole('button', { name: /^持倉$/ }).first().click();
    await expect(page.locator('.wb-hero-pnl-num').first()).toBeVisible();
    await expectNoHorizontalScroll(page, 'holdings 回訪');

    expect(errors.filter((e) => !/ResizeObserver|Non-Error promise|traffic-ingest|CORS|ERR_FAILED|Failed to load resource|\[TradeTab\]/i.test(e))).toEqual([]);
  });

  test('手機 390：DailyTab / LogTab 切換不橫向 scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoDemo(page);

    await page.getByRole('button', { name: /^收盤$/ }).first().click();
    await page.waitForTimeout(300);
    await expectNoHorizontalScroll(page, 'mobile daily');

    await page.getByRole('button', { name: /^記錄$/ }).first().click();
    await page.waitForTimeout(300);
    await expectNoHorizontalScroll(page, 'mobile log');

    await page.getByRole('button', { name: /^持倉$/ }).first().click();
    await page.waitForTimeout(300);
    await expectNoHorizontalScroll(page, 'mobile holdings');
  });
});
