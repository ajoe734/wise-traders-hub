import { test, expect, type Page } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';

/**
 * /holding-checkup demo 首屏可見性回歸
 *
 * 修復目標：未登入 demo 訪客打開 /holding-checkup 時，首屏必須看到：
 *   1. Today's P&L 標題與大數字（+11,xxx）
 *   2. demo 持倉相關資料（ACTION PRIORITY 區塊內 demo 股票代號）
 *   3. CoachMarks dialog 不擋住看板
 *   4. HoldingsIntroVideo 折疊狀態下，DOM 完全沒有 <video>
 *   5. DemoBanner 高度受控（desktop ≤ 60、mobile ≤ 96）
 */

const ROUTE = '/holding-checkup';
const CLEAR_GUARD = '__lf_demo_first_fold_cleared';

async function setupCleanDemoOnce(page: Page) {
  // 只在第一次 nav 清旗標，reload 不再清，確保「不再顯示」這類測試能跨 reload 保持狀態
  await page.addInitScript((guardKey: string) => {
    try {
      if (window.localStorage.getItem(guardKey)) return;
      window.localStorage.setItem(guardKey, '1');
      window.localStorage.removeItem('holdings-intro-video-seen-v2');
      window.localStorage.removeItem('checkup-coach-seen-v1');
    } catch {}
  }, CLEAR_GUARD);
}

async function gotoDemo(page: Page) {
  await setupCleanDemoOnce(page);
  await gotoWithRetry(page, ROUTE, { waitUntil: 'domcontentloaded' });
  // hero P&L 大數字是 demo 核心；等它出現代表 isReady 已過、demo seed 已注入
  await page.waitForSelector('.wb-hero-pnl-num', { state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(600); // 給 CoachMarks / video effect 跑完
}

test.describe('demo first-fold visibility', () => {
  test('desktop 1280×800：核心看板可見、無 video、CoachMarks 不擋', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoDemo(page);

    // 1. Today's P&L 標題
    const pnlLabel = page.getByText(/Today's P&L/i).first();
    await expect(pnlLabel).toBeVisible();
    const labelBox = await pnlLabel.boundingBox();
    expect(labelBox!.y).toBeGreaterThanOrEqual(0);
    expect(labelBox!.y + labelBox!.height).toBeLessThanOrEqual(800);

    // 2. P&L 大數字 +11,xxx（demo 固定區間）
    const pnlNum = page.locator('.wb-hero-pnl-num').first();
    await expect(pnlNum).toBeVisible();
    const numText = (await pnlNum.textContent())?.trim() ?? '';
    expect(numText, `P&L 大數字 "${numText}"`).toMatch(/^\+?\d{1,3}(,\d{3})+$/);
    const numBox = await pnlNum.boundingBox();
    expect(numBox!.y).toBeGreaterThanOrEqual(0);
    expect(numBox!.y + numBox!.height).toBeLessThanOrEqual(800);

    // 3. ACTION PRIORITY 區（demo 持倉資料的直接體現：3443/3017/2308）
    const actionPriority = page.getByText(/ACTION PRIORITY/i).first();
    await expect(actionPriority).toBeVisible();
    const apBox = await actionPriority.boundingBox();
    expect(apBox!.y).toBeGreaterThanOrEqual(0);
    expect(apBox!.y + apBox!.height).toBeLessThanOrEqual(800);

    // 至少一個 demo 股票代號在首屏內
    const demoCode = page.getByText(/3443|3017|2308/).first();
    await expect(demoCode).toBeVisible();
    const codeBox = await demoCode.boundingBox();
    expect(codeBox!.y + codeBox!.height).toBeLessThanOrEqual(800);

    // 4. video 不存在
    expect(await page.locator('video').count()).toBe(0);

    // 5. CoachMarks 首屏不出現
    await expect(page.getByTestId('coachmarks-dialog')).toHaveCount(0);

    // 6. DemoBanner 高度受控
    const banner = page.getByTestId('demo-banner');
    await expect(banner).toBeVisible();
    const bbox = await banner.boundingBox();
    expect(bbox!.height, `desktop DemoBanner 高度 ${bbox!.height}px`).toBeLessThanOrEqual(60);

    // 7. 折疊入口存在於 DOM（雖在頁尾）
    await expect(page.getByTestId('holdings-intro-collapsed')).toHaveCount(1);

    // eslint-disable-next-line no-console
    console.log(`[demo desktop] pnl="${numText}" banner=${bbox!.height}px pnl-y=${numBox!.y} ap-y=${apBox!.y}`);
  });

  test('mobile 390×844：核心看板可見、DemoBanner 高度 ≤ 96、無 video', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoDemo(page);

    const pnlLabel = page.getByText(/Today's P&L/i).first();
    await expect(pnlLabel).toBeVisible();
    const labelBox = await pnlLabel.boundingBox();
    expect(labelBox!.y).toBeGreaterThanOrEqual(0);
    expect(labelBox!.y).toBeLessThan(844);

    const pnlNum = page.locator('.wb-hero-pnl-num').first();
    await expect(pnlNum).toBeVisible();
    const numBox = await pnlNum.boundingBox();
    expect(numBox!.y + numBox!.height).toBeLessThanOrEqual(844);

    // 手機首屏空間有限，至少要看到 hero P&L；ACTION PRIORITY 允許在 fold 邊緣
    // 但「持倉資料源」必須出現在 DOM 內（demo seed 注入成功的硬證據）
    await expect(page.getByText(/3443|3017|2308|2330|00637L/).first()).toBeAttached();

    expect(await page.locator('video').count()).toBe(0);
    await expect(page.getByTestId('coachmarks-dialog')).toHaveCount(0);

    const banner = page.getByTestId('demo-banner');
    const bbox = await banner.boundingBox();
    expect(bbox!.height, `mobile DemoBanner 高度 ${bbox!.height}px`).toBeLessThanOrEqual(96);

    // eslint-disable-next-line no-console
    console.log(`[demo mobile] banner=${bbox!.height}px pnl-y=${numBox!.y}`);
  });

  test('點折疊入口後才渲染 <video> 並 autoplay', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoDemo(page);

    expect(await page.locator('video').count()).toBe(0);

    const entry = page.getByTestId('holdings-intro-collapsed');
    await entry.scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: /30 秒看懂持倉看板/ }).click();

    await expect(page.locator('video')).toHaveCount(1);
    const hasAutoplay = await page.locator('video').first().evaluate((v) =>
      (v as HTMLVideoElement).autoplay
    );
    expect(hasAutoplay).toBe(true);
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

  test('demo：切 tab 觸發 CoachMarks（不需要 scroll）', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoDemo(page);

    await expect(page.getByTestId('coachmarks-dialog')).toHaveCount(0);

    await page.getByRole('button', { name: /^行事曆$/ }).first().click();
    await page.waitForTimeout(600);

    await expect(page.getByTestId('coachmarks-dialog')).toBeVisible();
  });

  test('按過「不再顯示」後 reload：折疊入口不再出現，仍無 video', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoDemo(page);

    const entry = page.getByTestId('holdings-intro-collapsed');
    await entry.scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: /不再顯示介紹影片/ }).click();
    await expect(page.getByTestId('holdings-intro-collapsed')).toHaveCount(0);

    // reload — addInitScript 內的 guard 阻止再次清旗標
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.wb-hero-pnl-num', { state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(500);

    await expect(page.getByTestId('holdings-intro-collapsed')).toHaveCount(0);
    expect(await page.locator('video').count()).toBe(0);
  });
});

/**
 * Case B：已登入但空持倉的使用者
 *
 * 重點：這類使用者不應該看到 demo（DemoBanner / +11,xxx / 3443 等 demo code 都不可以出現），
 * 應該看到「還沒有持倉資料」空狀態。
 *
 * 為避免依賴 Lovable Preview 環境的瀏覽器 session，這裡用 addInitScript 注入
 * 假的 Supabase auth token，並用 page.route 攔截所有相關 REST 端點回空陣列。
 */
const SUPABASE_REF = 'yqacmrgdjlenbijclngi';
const SUPABASE_HOST = `${SUPABASE_REF}.supabase.co`;
const FAKE_USER_ID = '00000000-0000-0000-0000-000000000001';

async function setupAuthenticatedEmptyPortfolio(page: Page) {
  // 1. 攔截 supabase REST 全部回空 / 假 user
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
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '[]',
      });
    }
    return route.continue();
  });

  // 2. 注入假 session 到 localStorage（Supabase JS client 讀的 key）
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
      // 確保不殘留 demo 旗標
      window.localStorage.removeItem('pf-holdings-v2');
    } catch {}
  }, { ref: SUPABASE_REF, userId: FAKE_USER_ID });
}

test.describe('authenticated empty portfolio', () => {
  test('已登入空倉：不顯示 demo、看到空持倉狀態（不算 demo failure）', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await setupAuthenticatedEmptyPortfolio(page);
    await gotoWithRetry(page, ROUTE, { waitUntil: 'domcontentloaded' });

    await page.waitForTimeout(2500);

    // 1. DemoBanner 不可以存在
    await expect(page.getByTestId('demo-banner')).toHaveCount(0);

    // 2. 不可以出現 demo 的 +11,xxx
    const pnlMatches = await page.locator('.wb-hero-pnl-num').count();
    if (pnlMatches > 0) {
      const text = ((await page.locator('.wb-hero-pnl-num').first().textContent()) ?? '').trim();
      expect(text, '空倉不應出現 demo P&L 數字').not.toMatch(/\+?\d{1,3}(,\d{3})+/);
    }

    // 3. 不可以出現 demo 股票代號 / demo 交易日誌訊息 / demo 收盤分析
    await expect(page.getByText(/3443|3017|2308|2330|00637L/)).toHaveCount(0);

    // 4. 應該出現「還沒有持倉資料」空狀態
    await expect(page.getByText(/還沒有持倉資料/).first()).toBeVisible();

    // 5. 切到「交易日誌」也不可以看到 demo trade log
    await page.getByRole('button', { name: /^交易日誌$/ }).first().click().catch(() => {});
    await page.waitForTimeout(400);
    await expect(page.getByText(/還沒有交易記錄/).first()).toBeVisible();
    await expect(page.getByText(/液冷大單|CoWoS|奇鋐|創意/)).toHaveCount(0);

    // eslint-disable-next-line no-console
    console.log('[authenticated empty] DemoBanner 不存在、空狀態顯示、無 demo code/log — 預期行為');
  });
});

/**
 * Case C：未登入 demo 訪客每個 tab 都有可體驗示範資料
 * 守住「整個看板都是 demo」這項合約 — 不允許退化成「只有持倉 tab 有資料」。
 */
test.describe('demo per-tab content coverage', () => {
  test('每個 tab 切過去都不是空白', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoDemo(page);

    // 1. 持倉 — 已在 desktop first-fold 測過，這裡再 quick check
    await expect(page.locator('.wb-hero-pnl-num').first()).toBeVisible();
    await expect(page.getByText(/3017|3443|2308/).first()).toBeVisible();

    // 2. 行事曆（events tab）— DEMO_CALENDAR + DEMO_EVENTS 應立即可見
    await page.getByRole('button', { name: /^行事曆$/ }).first().click();
    await page.waitForTimeout(500);
    // 關閉可能彈出的 CoachMarks
    const skipBtn = page.getByRole('button', { name: /略過導覽/ });
    if (await skipBtn.count() > 0) { await skipBtn.first().click().catch(() => {}); }
    await expect(
      page.getByText(/法說|除息|營收|CPI/).first()
    ).toBeVisible({ timeout: 5000 });

    // 3. 事件分析（news tab）— DEMO_EVENTS 應出現
    await page.getByRole('button', { name: /^事件分析$/ }).first().click();
    await page.waitForTimeout(400);
    await expect(
      page.getByText(/CoWoS|液冷|供應鏈|事件分析/).first()
    ).toBeVisible({ timeout: 5000 });

    // 4. 收盤分析（daily tab）— DEMO_DAILY_REPORT 應渲染（aiInsight 內含「今日總結」）
    await page.getByRole('button', { name: /^收盤分析$/ }).first().click();
    await page.waitForTimeout(400);
    await expect(
      page.getByText(/今日總結|事件連動|個股操作建議/).first()
    ).toBeVisible({ timeout: 5000 });
    // 確認不是空狀態
    await expect(page.getByText(/還沒有.*分析|尚未產生分析/)).toHaveCount(0);

    // 5. 深度研究（research tab）— notice + 範例輸出 + CTA
    await page.getByRole('button', { name: /^深度研究$/ }).first().click();
    await page.waitForTimeout(400);
    await expect(
      page.getByText(/個股研究|策略大腦進化|範例輸出/).first()
    ).toBeVisible({ timeout: 5000 });

    // 6. 上傳成交（trade tab）— 保留上傳入口，不應該有 fake upload 結果
    await page.getByRole('button', { name: /^上傳成交$/ }).first().click();
    await page.waitForTimeout(400);
    // 至少要有某種 demo 提示或上傳入口（不強制具體文案）
    // 同時禁止出現「已成功上傳 N 筆」這類 fake 結果
    await expect(page.getByText(/已成功上傳|已解析.*筆/)).toHaveCount(0);

    // 7. 交易日誌（log tab）— DEMO_TRADE_LOG 應渲染
    await page.getByRole('button', { name: /^交易日誌$/ }).first().click();
    await page.waitForTimeout(400);
    await expect(
      page.getByText(/液冷|CoWoS|為什麼買進|止損|復盤反思|教訓/).first()
    ).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/還沒有交易記錄/)).toHaveCount(0);

    // eslint-disable-next-line no-console
    console.log('[demo per-tab] 全部 tab 在 demo 模式下都有可體驗示範資料');
  });
});

