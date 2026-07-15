import { test, expect, type Page } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';

/**
 * Batch D §2 回歸：手機頂欄「⋯ 更多」actions sheet
 *
 * 1. 打開 CTA → sheet 顯示、body overflow=hidden、無橫向 scroll
 * 2. 三條關閉路徑：× 按鈕 / ESC / 背景遮罩 皆可關閉，overflow 復原
 * 3. 各選項點擊後：sheet 自動關閉且觸發對應副作用
 *    - 「清除全部資料」→ 開啟 confirm modal
 *    - 「取消」→ 直接關閉
 *    - 「⟳ 立即更新報價」→ 關閉並顯示 syncing/toast（demo 模式下不會壞）
 */

const ROUTE = '/holding-checkup?demo=1';
const CLEAR_GUARD = '__lf_mobile_actions_sheet_e2e_cleared';

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

async function gotoDemoMobile(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupCleanDemoOnce(page);
  await gotoWithRetry(page, ROUTE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.wb-hero-pnl-num', { state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(400);
}

async function expectNoHorizontalScroll(page: Page, label: string) {
  const ov = await page.evaluate(() => {
    const el = document.documentElement;
    return { sw: el.scrollWidth, cw: el.clientWidth };
  });
  expect(ov.sw, `${label}: scrollWidth=${ov.sw} clientWidth=${ov.cw}`).toBeLessThanOrEqual(ov.cw + 1);
}

function collectConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e?.message || e)));
  return errors;
}

const NOISE = /ResizeObserver|Non-Error promise|traffic-ingest|CORS|ERR_FAILED|Failed to load resource|\[TradeTab\]/i;

test.describe('FreeCheckup 手機頂欄「更多」sheet — Batch D §2', () => {
  test('CTA 開啟 sheet：body overflow 鎖定、無橫向 scroll、aria-expanded=true', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await gotoDemoMobile(page);

    const cta = page.getByTestId('checkup-mobile-more-cta');
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute('aria-expanded', 'false');

    await cta.click();
    const sheet = page.getByTestId('mobile-actions-sheet');
    await expect(sheet).toBeVisible();
    await expect(cta).toHaveAttribute('aria-expanded', 'true');

    // body overflow lock
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    await expectNoHorizontalScroll(page, 'sheet 開啟');

    // dialog a11y
    await expect(sheet).toHaveAttribute('role', 'dialog');
    await expect(sheet).toHaveAttribute('aria-modal', 'true');
    await expect(sheet).toHaveAttribute('aria-labelledby', 'cm-mobile-actions-title');
    await expect(cta).toHaveAttribute('aria-controls', 'cm-mobile-actions-sheet');
    // backdrop 對讀屏隱藏
    await expect(page.getByTestId('mobile-actions-sheet-backdrop')).toHaveAttribute('aria-hidden', 'true');
    // aria-labelledby 指向的標題實際存在且文字為「更多」
    await expect(page.locator('#cm-mobile-actions-title')).toHaveText('更多');

    // 初次焦點應落在 sheet 容器內（focus trap 前置條件）
    await page.waitForTimeout(50);
    const focusedInsideSheet = await page.evaluate(() => {
      const sheet = document.querySelector('[data-testid="mobile-actions-sheet"]');
      return !!sheet && (sheet === document.activeElement || sheet.contains(document.activeElement));
    });
    expect(focusedInsideSheet).toBe(true);

    expect(errors.filter((e) => !NOISE.test(e))).toEqual([]);
  });

  test('鍵盤焦點陷阱：Tab 循環在 sheet 內、Shift+Tab 反向亦不外洩', async ({ page }) => {
    await gotoDemoMobile(page);
    await page.getByTestId('checkup-mobile-more-cta').click();
    const sheet = page.getByTestId('mobile-actions-sheet');
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(50);

    // 連按 12 次 Tab，焦點永遠應在 sheet 內
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() => {
        const s = document.querySelector('[data-testid="mobile-actions-sheet"]');
        return !!s && s.contains(document.activeElement);
      });
      expect(inside, `第 ${i + 1} 次 Tab 焦點跑出 sheet`).toBe(true);
    }
    // Shift+Tab 也不外洩
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Shift+Tab');
      const inside = await page.evaluate(() => {
        const s = document.querySelector('[data-testid="mobile-actions-sheet"]');
        return !!s && s.contains(document.activeElement);
      });
      expect(inside, `第 ${i + 1} 次 Shift+Tab 焦點跑出 sheet`).toBe(true);
    }
  });

  test('關閉後焦點回到觸發按鈕（× / ESC / 背景 三條路徑）', async ({ page }) => {
    await gotoDemoMobile(page);
    const cta = page.getByTestId('checkup-mobile-more-cta');

    // 路徑 1：× 關閉
    await cta.click();
    await expect(page.getByTestId('mobile-actions-sheet')).toBeVisible();
    await page.getByTestId('mobile-actions-sheet-close').click();
    await expect(page.getByTestId('mobile-actions-sheet')).toHaveCount(0);
    await page.waitForTimeout(50);
    expect(await page.evaluate(() =>
      document.activeElement?.getAttribute('data-testid')
    )).toBe('checkup-mobile-more-cta');

    // 路徑 2：ESC 關閉
    await cta.click();
    await expect(page.getByTestId('mobile-actions-sheet')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('mobile-actions-sheet')).toHaveCount(0);
    await page.waitForTimeout(50);
    expect(await page.evaluate(() =>
      document.activeElement?.getAttribute('data-testid')
    )).toBe('checkup-mobile-more-cta');

    // 路徑 3：背景遮罩關閉
    await cta.click();
    await expect(page.getByTestId('mobile-actions-sheet')).toBeVisible();
    await page.getByTestId('mobile-actions-sheet-backdrop').click();
    await expect(page.getByTestId('mobile-actions-sheet')).toHaveCount(0);
    await page.waitForTimeout(50);
    expect(await page.evaluate(() =>
      document.activeElement?.getAttribute('data-testid')
    )).toBe('checkup-mobile-more-cta');
  });

  test('× 按鈕關閉 sheet：overflow 復原', async ({ page }) => {
    await gotoDemoMobile(page);
    await page.getByTestId('checkup-mobile-more-cta').click();
    const sheet = page.getByTestId('mobile-actions-sheet');
    await expect(sheet).toBeVisible();

    await page.getByTestId('mobile-actions-sheet-close').click();
    await expect(sheet).toHaveCount(0);
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  });

  test('ESC 關閉 sheet：overflow 復原', async ({ page }) => {
    await gotoDemoMobile(page);
    await page.getByTestId('checkup-mobile-more-cta').click();
    const sheet = page.getByTestId('mobile-actions-sheet');
    await expect(sheet).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  });

  test('背景遮罩關閉 sheet', async ({ page }) => {
    await gotoDemoMobile(page);
    await page.getByTestId('checkup-mobile-more-cta').click();
    const sheet = page.getByTestId('mobile-actions-sheet');
    await expect(sheet).toBeVisible();

    await page.getByTestId('mobile-actions-sheet-backdrop').click();
    await expect(sheet).toHaveCount(0);
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  });

  test('「取消」按鈕：關閉 sheet 且不觸發任何副作用', async ({ page }) => {
    await gotoDemoMobile(page);
    await page.getByTestId('checkup-mobile-more-cta').click();
    const sheet = page.getByTestId('mobile-actions-sheet');
    await expect(sheet).toBeVisible();

    await sheet.getByRole('button', { name: '取消', exact: true }).click();
    await expect(sheet).toHaveCount(0);
    // reset confirm 不應被開啟
    await expect(page.getByText('確認全部清除')).toHaveCount(0);
  });

  test('「清除全部資料」：關閉 sheet 並開啟 reset confirm', async ({ page }) => {
    await gotoDemoMobile(page);
    await page.getByTestId('checkup-mobile-more-cta').click();
    const sheet = page.getByTestId('mobile-actions-sheet');
    await expect(sheet).toBeVisible();

    await sheet.getByRole('button', { name: '清除全部資料', exact: true }).click();
    await expect(sheet).toHaveCount(0);
    // 出現確認 modal
    await expect(page.getByRole('button', { name: '確認全部清除' })).toBeVisible({ timeout: 3000 });
  });

  test('「⟳ 立即更新報價」：關閉 sheet 且不噴 console error', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await gotoDemoMobile(page);
    await page.getByTestId('checkup-mobile-more-cta').click();
    const sheet = page.getByTestId('mobile-actions-sheet');
    await expect(sheet).toBeVisible();

    const syncBtn = sheet.getByRole('button', { name: /立即更新報價|同步中/ });
    await expect(syncBtn).toBeVisible();
    await syncBtn.click();
    await expect(sheet).toHaveCount(0);
    // 給 async sync 一點時間
    await page.waitForTimeout(600);
    expect(errors.filter((e) => !NOISE.test(e))).toEqual([]);
  });
});
