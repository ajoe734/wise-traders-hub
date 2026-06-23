import { test, expect, type Page } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';

/**
 * /holding-checkup demo 首屏可見性回歸 + demo intro video **modal** 行為
 *
 * 修復目標（demo first-fold v3）：
 *   1. Today's P&L 標題與大數字（+11,xxx）首屏可見
 *   2. demo 持倉（ACTION PRIORITY、3443/3017/2308）首屏可見
 *   3. CoachMarks 不擋首屏
 *   4. DemoBanner 高度受控（desktop ≤ 60、mobile ≤ 96）
 *   5. demo intro video **改為一次性 modal**：首次進入 demo 自動彈出；
 *      關閉後本 session + reload 都不再彈；切 tab 不重彈；video 只在 modal 開啟時 mount
 *   6. 已登入空倉：不得看到 modal、DemoBanner、demo data
 */

const ROUTE = '/holding-checkup?demo=1'; // dev-only force-demo，避免被 Lovable Preview session 污染
const CLEAR_GUARD = '__lf_demo_first_fold_cleared';

/**
 * 預設清掉「看過」flag，但**主動寫入「本 session 已關 modal」**，
 * 讓 first-fold 主測試不被 modal 擋住。
 * 只清一次（CLEAR_GUARD），讓 reload 後仍能保留「不再顯示」這類測試的狀態。
 */
async function setupCleanDemoOnce(page: Page) {
  await page.addInitScript((guardKey: string) => {
    try {
      if (window.localStorage.getItem(guardKey)) return;
      window.localStorage.setItem(guardKey, '1');
      window.localStorage.removeItem('holdings-intro-video-seen-v2');
      window.localStorage.removeItem('checkup-coach-seen-v1');
      window.sessionStorage.setItem('holdings-intro-video-dismissed-session', '1');
    } catch {}
  }, CLEAR_GUARD);
}

/** 主動讓 modal 在本次 nav 中自動彈出（清掉所有 dismiss flag）。 */
async function allowIntroModalToOpen(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.removeItem('holdings-intro-video-seen-v2');
      window.sessionStorage.removeItem('holdings-intro-video-dismissed-session');
    } catch {}
  });
}

async function gotoDemo(page: Page) {
  await setupCleanDemoOnce(page);
  await gotoWithRetry(page, ROUTE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.wb-hero-pnl-num', { state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(600);
}

test.describe('demo first-fold visibility', () => {
  test('desktop 1280×800：核心看板可見、CoachMarks 不擋', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoDemo(page);

    const pnlLabel = page.getByText(/Today's P&L/i).first();
    await expect(pnlLabel).toBeVisible();
    const labelBox = await pnlLabel.boundingBox();
    expect(labelBox!.y).toBeGreaterThanOrEqual(0);
    expect(labelBox!.y + labelBox!.height).toBeLessThanOrEqual(800);

    const pnlNum = page.locator('.wb-hero-pnl-num').first();
    await expect(pnlNum).toBeVisible();
    const numText = (await pnlNum.textContent())?.trim() ?? '';
    expect(numText, `P&L 大數字 "${numText}"`).toMatch(/^\+?\d{1,3}(,\d{3})+$/);
    const numBox = await pnlNum.boundingBox();
    expect(numBox!.y + numBox!.height).toBeLessThanOrEqual(800);

    const actionPriority = page.getByText(/ACTION PRIORITY/i).first();
    await expect(actionPriority).toBeVisible();

    const demoCode = page.getByText(/3443|3017|2308/).first();
    await expect(demoCode).toBeVisible();

    // modal 已被 setupCleanDemoOnce 標為 dismissed → 不應渲染、video count = 0
    await expect(page.getByTestId('holdings-intro-modal')).toHaveCount(0);
    expect(await page.locator('video').count()).toBe(0);

    await expect(page.getByTestId('coachmarks-dialog')).toHaveCount(0);

    const banner = page.getByTestId('demo-banner');
    await expect(banner).toBeVisible();
    const bbox = await banner.boundingBox();
    expect(bbox!.height, `desktop DemoBanner 高度 ${bbox!.height}px`).toBeLessThanOrEqual(60);

    // eslint-disable-next-line no-console
    console.log(`[demo desktop] pnl="${numText}" banner=${bbox!.height}px`);
  });

  test('mobile 390×844：核心看板可見、DemoBanner ≤ 96', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoDemo(page);

    const pnlLabel = page.getByText(/Today's P&L/i).first();
    await expect(pnlLabel).toBeVisible();
    const pnlNum = page.locator('.wb-hero-pnl-num').first();
    await expect(pnlNum).toBeVisible();
    const numBox = await pnlNum.boundingBox();
    expect(numBox!.y + numBox!.height).toBeLessThanOrEqual(844);

    await expect(page.getByText(/3443|3017|2308|2330|00637L/).first()).toBeAttached();

    await expect(page.getByTestId('holdings-intro-modal')).toHaveCount(0);
    expect(await page.locator('video').count()).toBe(0);

    const banner = page.getByTestId('demo-banner');
    const bbox = await banner.boundingBox();
    expect(bbox!.height, `mobile DemoBanner 高度 ${bbox!.height}px`).toBeLessThanOrEqual(96);
  });

  test('demo intro modal：首次進入 demo 自動彈出，關閉後 unmount video，切 tab 不重彈', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await allowIntroModalToOpen(page);
    await gotoWithRetry(page, ROUTE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.wb-hero-pnl-num', { state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(500);

    // 自動彈出 + video mount
    const modal = page.getByTestId('holdings-intro-modal');
    await expect(modal).toBeVisible();
    await expect(page.locator('video')).toHaveCount(1);
    const autoplay = await page.locator('video').first().evaluate((v) => (v as HTMLVideoElement).autoplay);
    expect(autoplay).toBe(true);

    // 按 ✕ 關閉 → modal 消失、video unmount
    await page.getByRole('button', { name: /關閉介紹影片/ }).click();
    await expect(modal).toHaveCount(0);
    expect(await page.locator('video').count()).toBe(0);

    // 切 tab → modal 不重彈
    await page.getByRole('button', { name: /^行事曆$/ }).first().click();
    await page.waitForTimeout(400);
    await expect(modal).toHaveCount(0);
    expect(await page.locator('video').count()).toBe(0);

    await page.getByRole('button', { name: /^交易日誌$/ }).first().click();
    await page.waitForTimeout(400);
    await expect(modal).toHaveCount(0);
    expect(await page.locator('video').count()).toBe(0);
  });

  test('demo intro modal：「不再顯示」後 reload 仍不出現', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await allowIntroModalToOpen(page);
    await gotoWithRetry(page, ROUTE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.wb-hero-pnl-num', { state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(500);

    await expect(page.getByTestId('holdings-intro-modal')).toBeVisible();
    await page.getByRole('button', { name: /不再顯示介紹影片/ }).click();
    await expect(page.getByTestId('holdings-intro-modal')).toHaveCount(0);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.wb-hero-pnl-num', { state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(500);

    await expect(page.getByTestId('holdings-intro-modal')).toHaveCount(0);
    expect(await page.locator('video').count()).toBe(0);
  });

  test('demo：scroll>200px 才彈 CoachMarks，且關閉後不重彈', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoDemo(page);

    await expect(page.getByTestId('coachmarks-dialog')).toHaveCount(0);
    await page.evaluate(() => window.scrollTo(0, 150));
    await page.waitForTimeout(300);
    await expect(page.getByTestId('coachmarks-dialog')).toHaveCount(0);
    await page.evaluate(() => window.scrollTo(0, 350));
    await page.waitForTimeout(400);
    await expect(page.getByTestId('coachmarks-dialog')).toBeVisible();
    await page.getByRole('button', { name: /略過導覽/ }).click();
    await expect(page.getByTestId('coachmarks-dialog')).toHaveCount(0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(300);
    await expect(page.getByTestId('coachmarks-dialog')).toHaveCount(0);
  });
});

/**
 * Case B：已登入但空持倉的使用者
 *
 * 不傳 `?demo=1`。攔截 supabase REST 全部回空，注入假 session。
 * 必須看到「還沒有持倉資料」空狀態，**且不可以有 demo 任何痕跡**（含 modal）。
 */
const SUPABASE_REF = 'yqacmrgdjlenbijclngi';
const SUPABASE_HOST = `${SUPABASE_REF}.supabase.co`;
const FAKE_USER_ID = '00000000-0000-0000-0000-000000000001';

async function setupAuthenticatedEmptyPortfolio(page: Page) {
  await page.route(`https://${SUPABASE_HOST}/**`, async (route) => {
    const url = route.request().url();
    if (url.includes('/auth/v1/user')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: FAKE_USER_ID, aud: 'authenticated', role: 'authenticated' }),
      });
    }
    if (url.includes('/rest/v1/checkup_storage') || url.includes('/rest/v1/checkup_trade_memos')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    return route.continue();
  });

  await page.addInitScript(({ ref, userId }) => {
    try {
      const key = `sb-${ref}-auth-token`;
      const session = {
        access_token: 'fake-access-token',
        refresh_token: 'fake-refresh-token',
        token_type: 'bearer',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        expires_in: 3600,
        user: { id: userId, aud: 'authenticated', role: 'authenticated' },
      };
      window.localStorage.setItem(key, JSON.stringify(session));
      window.localStorage.removeItem('pf-holdings-v2');
      // 確保不會殘留任何 force-demo flag
      window.sessionStorage.removeItem('lf_force_demo');
    } catch {}
  }, { ref: SUPABASE_REF, userId: FAKE_USER_ID });
}

test.describe('authenticated empty portfolio', () => {
  test('已登入空倉：無 DemoBanner / 無 demo data / 無 intro modal', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await setupAuthenticatedEmptyPortfolio(page);
    await gotoWithRetry(page, '/holding-checkup', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    await expect(page.getByTestId('demo-banner')).toHaveCount(0);
    await expect(page.getByTestId('holdings-intro-modal')).toHaveCount(0);
    expect(await page.locator('video').count()).toBe(0);

    const pnlMatches = await page.locator('.wb-hero-pnl-num').count();
    if (pnlMatches > 0) {
      const text = ((await page.locator('.wb-hero-pnl-num').first().textContent()) ?? '').trim();
      expect(text, '空倉不應出現 demo P&L 數字').not.toMatch(/\+?\d{1,3}(,\d{3})+/);
    }

    await expect(page.getByText(/3443|3017|2308|2330|00637L/)).toHaveCount(0);
    await expect(page.getByText(/還沒有持倉資料/).first()).toBeVisible();

    await page.getByRole('button', { name: /^交易日誌$/ }).first().click().catch(() => {});
    await page.waitForTimeout(400);
    await expect(page.getByText(/還沒有交易記錄/).first()).toBeVisible();
    await expect(page.getByText(/液冷大單|CoWoS|奇鋐|創意/)).toHaveCount(0);
  });
});

/**
 * Case C：未登入 demo 訪客每個 tab 都有可體驗示範資料
 */
test.describe('demo per-tab content coverage', () => {
  test('每個 tab 切過去都不是空白', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoDemo(page);

    await expect(page.locator('.wb-hero-pnl-num').first()).toBeVisible();
    await expect(page.getByText(/3017|3443|2308/).first()).toBeVisible();

    await page.getByRole('button', { name: /^行事曆$/ }).first().click();
    await page.waitForTimeout(500);
    const skipBtn = page.getByRole('button', { name: /略過導覽/ });
    if (await skipBtn.count() > 0) { await skipBtn.first().click().catch(() => {}); }
    await expect(page.getByText(/法說|除息|營收|CPI/).first()).toBeVisible({ timeout: 5000 });

    await page.getByRole('button', { name: /^事件分析$/ }).first().click();
    await page.waitForTimeout(400);
    await expect(page.getByText(/CoWoS|液冷|供應鏈|事件分析/).first()).toBeVisible({ timeout: 5000 });

    await page.getByRole('button', { name: /^收盤分析$/ }).first().click();
    await page.waitForTimeout(400);
    await expect(page.getByText(/今日總結|事件連動|個股操作建議/).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/還沒有.*分析|尚未產生分析/)).toHaveCount(0);

    await page.getByRole('button', { name: /^深度研究$/ }).first().click();
    await page.waitForTimeout(400);
    await expect(page.getByText(/個股研究|策略大腦進化|範例輸出/).first()).toBeVisible({ timeout: 5000 });

    await page.getByRole('button', { name: /^上傳成交$/ }).first().click();
    await page.waitForTimeout(400);
    await expect(page.getByText(/已成功上傳|已解析.*筆/)).toHaveCount(0);

    await page.getByRole('button', { name: /^交易日誌$/ }).first().click();
    await page.waitForTimeout(400);
    await expect(page.getByText(/液冷|CoWoS|為什麼買進|止損|復盤反思|教訓/).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/還沒有交易記錄/)).toHaveCount(0);
  });
});
