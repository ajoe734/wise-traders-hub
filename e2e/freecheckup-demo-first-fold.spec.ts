import { test, expect, type Page } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';

/**
 * /holding-checkup demo 首屏可見性回歸
 *
 * 修復目標：未登入 demo 訪客打開 /holding-checkup 時，首屏必須看到：
 *   1. Today's P&L 標題與大數字
 *   2. 至少一張持倉卡（demo seed 20 檔之一）
 *   3. CoachMarks modal 不擋住看板
 *   4. HoldingsIntroVideo 折疊狀態下，DOM 完全沒有 <video>
 *
 * 額外驗證：
 *   - DemoBanner 高度受控（desktop ≤ 60、mobile ≤ 96）
 *   - 點折疊入口才會出現 <video>
 *   - demo 模式 scroll>200 或切 tab 才彈 CoachMarks（觸發後不重複彈）
 */

const ROUTE = '/holding-checkup';

async function clearDemoFlags(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.removeItem('holdings-intro-video-seen-v2');
      window.localStorage.removeItem('checkup-coach-seen-v1');
    } catch {}
  });
}

async function gotoDemo(page: Page) {
  await clearDemoFlags(page);
  await gotoWithRetry(page, ROUTE, { waitUntil: 'domcontentloaded' });
  // 等持倉卡渲染
  await page.waitForSelector('.holdings-card-grid .wb-card', { state: 'visible', timeout: 30_000 });
  // 給 useEffect 與 isReady 跑完
  await page.waitForTimeout(800);
}

function inViewport(box: { x: number; y: number; width: number; height: number } | null, vh: number) {
  if (!box) return false;
  return box.y >= 0 && box.y + box.height <= vh + 1;
}

test.describe('demo first-fold visibility', () => {
  test('desktop 1280×800：核心看板可見、無 video、CoachMarks 不擋', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoDemo(page);

    // 1. Today's P&L 在首屏
    const pnlLabel = page.getByText(/Today's P&L/i).first();
    await expect(pnlLabel).toBeVisible();
    const labelBox = await pnlLabel.boundingBox();
    expect(inViewport(labelBox, 800), `Today's P&L 位置 ${JSON.stringify(labelBox)}`).toBe(true);

    // 2. 至少一張持倉卡在首屏
    const firstCard = page.locator('.holdings-card-grid .wb-card').first();
    await expect(firstCard).toBeVisible();
    const cardBox = await firstCard.boundingBox();
    expect(cardBox, '至少一張持倉卡需有 boundingBox').not.toBeNull();
    // 卡片頂端必須在首屏內（允許底部被 fold 切到，但 top 必須可見）
    expect(cardBox!.y).toBeGreaterThanOrEqual(0);
    expect(cardBox!.y).toBeLessThan(800);

    // 3. video 不存在
    expect(await page.locator('video').count()).toBe(0);

    // 4. 折疊入口可見
    const introEntry = page.getByTestId('holdings-intro-collapsed');
    await expect(introEntry).toBeAttached();

    // 5. CoachMarks 首屏不出現
    await expect(page.getByTestId('coachmarks-dialog')).toHaveCount(0);

    // 6. DemoBanner 高度受控
    const banner = page.getByTestId('demo-banner');
    await expect(banner).toBeVisible();
    const bbox = await banner.boundingBox();
    expect(bbox!.height, `desktop DemoBanner 高度 ${bbox!.height}px`).toBeLessThanOrEqual(60);
  });

  test('mobile 390×844：核心看板可見、DemoBanner 高度 ≤ 96、無 video', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoDemo(page);

    const pnlLabel = page.getByText(/Today's P&L/i).first();
    await expect(pnlLabel).toBeVisible();
    const labelBox = await pnlLabel.boundingBox();
    expect(labelBox!.y).toBeGreaterThanOrEqual(0);
    expect(labelBox!.y).toBeLessThan(844);

    const firstCard = page.locator('.holdings-card-grid .wb-card').first();
    await expect(firstCard).toBeVisible();
    const cardBox = await firstCard.boundingBox();
    expect(cardBox!.y).toBeGreaterThanOrEqual(0);
    expect(cardBox!.y).toBeLessThan(844);

    expect(await page.locator('video').count()).toBe(0);
    await expect(page.getByTestId('coachmarks-dialog')).toHaveCount(0);

    const banner = page.getByTestId('demo-banner');
    const bbox = await banner.boundingBox();
    expect(bbox!.height, `mobile DemoBanner 高度 ${bbox!.height}px`).toBeLessThanOrEqual(96);
  });

  test('點折疊入口後才渲染 <video>', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoDemo(page);

    expect(await page.locator('video').count()).toBe(0);
    // 折疊入口在頁尾，需要 scroll 到底
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(200);

    const entryBtn = page.getByRole('button', { name: /30 秒看懂持倉看板/ });
    await entryBtn.click();

    await expect(page.locator('video')).toHaveCount(1);
    const hasAutoplay = await page.locator('video').first().evaluate((v) =>
      (v as HTMLVideoElement).autoplay
    );
    expect(hasAutoplay).toBe(true);
  });

  test('demo：scroll>200px 才彈 CoachMarks，且只彈一次', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoDemo(page);

    await expect(page.getByTestId('coachmarks-dialog')).toHaveCount(0);

    // scroll 不到 200，不應彈
    await page.evaluate(() => window.scrollTo(0, 150));
    await page.waitForTimeout(300);
    await expect(page.getByTestId('coachmarks-dialog')).toHaveCount(0);

    // scroll > 200，應彈
    await page.evaluate(() => window.scrollTo(0, 350));
    await page.waitForTimeout(400);
    await expect(page.getByTestId('coachmarks-dialog')).toBeVisible();

    // 關閉後再 scroll 不應重彈（已寫入 localStorage seen 或 triggered ref）
    await page.getByRole('button', { name: /略過導覽/ }).click();
    await expect(page.getByTestId('coachmarks-dialog')).toHaveCount(0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(300);
    await expect(page.getByTestId('coachmarks-dialog')).toHaveCount(0);
  });

  test('demo：切 tab 也能觸發 CoachMarks（不需要 scroll）', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoDemo(page);

    await expect(page.getByTestId('coachmarks-dialog')).toHaveCount(0);

    // 找 tab bar 上的「行事曆」或其它非 holdings tab
    const calendarTab = page.getByRole('button', { name: /行事曆/ }).first();
    await calendarTab.click();
    await page.waitForTimeout(800);

    await expect(page.getByTestId('coachmarks-dialog')).toBeVisible();
  });

  test('使用者按過「不再顯示」後重新整理，折疊入口不再出現', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoDemo(page);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(200);

    await page.getByRole('button', { name: /不再顯示介紹影片/ }).click();
    await expect(page.getByTestId('holdings-intro-collapsed')).toHaveCount(0);

    // reload — 不再注入 clearDemoFlags，沿用 localStorage
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.holdings-card-grid .wb-card', { state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(500);
    await expect(page.getByTestId('holdings-intro-collapsed')).toHaveCount(0);
    expect(await page.locator('video').count()).toBe(0);
  });
});
