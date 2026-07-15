import { test, expect, type Page, type Route } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';

/**
 * 多圖批次解析 e2e（FreeCheckup TradeTab → BatchParsePanel）
 *
 * 覆蓋情境：
 *   1. progress + per-item status：3 張全成功，header 顯示 (i/N)、items 由 pending→parsing→success
 *   2. cancel mid-run：4 張依序解析，第 2 張處理中按「停止批次」→ 前 2 張成功保留、後 2 張 cancelled
 *   3. retryBatchFailures：2 張中第 2 張失敗，按「重試失敗」只重跑失敗那張，成功項不變
 *
 * 為避免依賴真實後端：
 *   - 注入假 supabase session（authenticated）
 *   - mock 所有 REST GET 回 []，functions/v1/* 預設回 {}，checkup-parse 由各 test 自訂
 *   - 關掉 CoachMarks / intro modal flag
 */

const SUPABASE_REF = 'yqacmrgdjlenbijclngi';
const SUPABASE_HOST = `${SUPABASE_REF}.supabase.co`;
const FAKE_USER_ID = '00000000-0000-0000-0000-000000000099';
const ROUTE = '/holding-checkup';

/** 1x1 transparent PNG. */
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

function makeFile(name: string) {
  return { name, mimeType: 'image/png', buffer: PNG_1x1 };
}

function okOcrBody(code: string, name: string) {
  return JSON.stringify({
    content: [
      {
        text: JSON.stringify({
          trades: [{ action: '買進', code, name, qty: 1, price: 100 }],
        }),
      },
    ],
  });
}

const ERROR_OCR_BODY = JSON.stringify({ error: 'AI 解析失敗（mock）' });

/** 注入 auth session + 關閉 onboarding 干擾。 */
async function setupAuthenticated(page: Page) {
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
      window.localStorage.setItem('checkup-coach-seen-v1', '1');
      window.localStorage.setItem('holdings-intro-video-seen-v2', '1');
      window.localStorage.setItem('lf.checkup.onboarded', '1');
      window.sessionStorage.setItem('holdings-intro-video-dismissed-session', '1');
      window.localStorage.removeItem('pf-holdings-v2');
    } catch {}
  }, { ref: SUPABASE_REF, userId: FAKE_USER_ID });
}

/**
 * 安裝 supabase 路由攔截。`parseHandler` 由各 test 提供。
 * 其他 functions/REST/auth 全部回安全空值。
 */
async function installSupabaseRoutes(
  page: Page,
  parseHandler: (route: Route, callIdx: number) => Promise<void>,
) {
  let parseCallCount = 0;

  await page.route(`https://${SUPABASE_HOST}/**`, async (route) => {
    const url = route.request().url();

    if (url.includes('/functions/v1/checkup-parse')) {
      parseCallCount += 1;
      return parseHandler(route, parseCallCount);
    }
    if (url.includes('/functions/v1/')) {
      // 其他 edge function（stock-price-sync / checkup-twse / checkup-analyze …）
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, data: [], content: [{ text: '{}' }] }),
      });
    }
    if (url.includes('/auth/v1/user')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: FAKE_USER_ID, aud: 'authenticated', role: 'authenticated' }),
      });
    }
    if (url.includes('/rest/v1/')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    return route.continue();
  });

  return {
    getCallCount: () => parseCallCount,
  };
}

async function gotoTradeTab(page: Page) {
  await gotoWithRetry(page, ROUTE, { waitUntil: 'domcontentloaded' });
  // 點到「上傳成交」tab，找到隱藏的 file input
  await page.waitForTimeout(800);
  const tradeBtn = page.getByRole('button', { name: /^上傳成交$/ }).first();
  if (await tradeBtn.count()) await tradeBtn.click().catch(() => {});
  await page.waitForSelector('#fi', { state: 'attached', timeout: 15_000 });
}

async function uploadFiles(page: Page, names: string[]) {
  await page.locator('#fi').setInputFiles(names.map(makeFile));
}

test.describe('FreeCheckup 多圖批次解析', () => {
  test('1. 全成功：progress 條與 per-item 狀態正確更新', async ({ page }) => {
    await setupAuthenticated(page);
    await installSupabaseRoutes(page, async (route, idx) => {
      // 每張 ~250ms 模擬處理時間，但保留可觀察到 parsing 中間態
      await new Promise((r) => setTimeout(r, 250));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: okOcrBody(String(2330 + idx), `mock-${idx}`),
      });
    });
    await gotoTradeTab(page);

    await uploadFiles(page, ['shot-a.png', 'shot-b.png', 'shot-c.png']);

    const panel = page.getByTestId('batch-parse-panel');
    await expect(panel).toBeVisible({ timeout: 10_000 });

    // header 顯示批次解析中 + (i/N)
    await expect(page.getByTestId('batch-parse-header')).toHaveText(
      /批次解析中（\d+\/3）/,
      { timeout: 5_000 },
    );

    // 等批次完成（取消按鈕消失 → running=false）
    await expect(page.getByTestId('batch-cancel-btn')).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByTestId('batch-parse-header')).toHaveText(/批次解析完成 3\/3|批次完成：成功 3/);

    // 每張都 success，且名稱對齊
    const items = page.getByTestId('batch-item');
    await expect(items).toHaveCount(3);
    for (const name of ['shot-a.png', 'shot-b.png', 'shot-c.png']) {
      const it = page.locator(`[data-testid="batch-item"][data-batch-name="${name}"]`);
      await expect(it).toHaveAttribute('data-batch-status', 'success');
    }
  });

  test('2. 停止批次：當前完成 + 後續 cancelled，已完成項保留', async ({ page }) => {
    await setupAuthenticated(page);
    await installSupabaseRoutes(page, async (route, idx) => {
      // 每張處理 1.2 秒，讓我們有時間在第 2 張處理中按停止
      await new Promise((r) => setTimeout(r, 1200));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: okOcrBody(String(2330 + idx), `mock-${idx}`),
      });
    });
    await gotoTradeTab(page);

    await uploadFiles(page, ['a.png', 'b.png', 'c.png', 'd.png']);

    // 等第 1 張變 success
    await expect(
      page.locator('[data-testid="batch-item"][data-batch-name="a.png"]'),
    ).toHaveAttribute('data-batch-status', 'success', { timeout: 10_000 });

    // 等第 2 張進入 parsing
    await expect(
      page.locator('[data-testid="batch-item"][data-batch-name="b.png"]'),
    ).toHaveAttribute('data-batch-status', 'parsing', { timeout: 5_000 });

    // 點停止 → c/d 立刻被標 cancelled（pending → cancelled by cancelBatch）
    await page.getByTestId('batch-cancel-btn').click();

    // 等批次結束
    await expect(page.getByTestId('batch-cancel-btn')).toHaveCount(0, { timeout: 10_000 });

    // 結果：a, b = success（b 的當前那張會跑完）；c, d = cancelled
    await expect(
      page.locator('[data-testid="batch-item"][data-batch-name="a.png"]'),
    ).toHaveAttribute('data-batch-status', 'success');
    await expect(
      page.locator('[data-testid="batch-item"][data-batch-name="b.png"]'),
    ).toHaveAttribute('data-batch-status', 'success');
    await expect(
      page.locator('[data-testid="batch-item"][data-batch-name="c.png"]'),
    ).toHaveAttribute('data-batch-status', 'cancelled');
    await expect(
      page.locator('[data-testid="batch-item"][data-batch-name="d.png"]'),
    ).toHaveAttribute('data-batch-status', 'cancelled');

    await expect(page.getByTestId('batch-parse-header')).toHaveText(/已停止/);

    // 「重試失敗 2 張」應出現
    await expect(page.getByTestId('batch-retry-btn')).toBeVisible();
  });

  test('3. retryBatchFailures：只重跑 failed，成功項不被觸發', async ({ page }) => {
    await setupAuthenticated(page);
    // 計數策略：呼叫 #1 成功；呼叫 #2~#4（parseShot 內 3 次 retry）失敗；
    // 重試後 #5 成功。
    const FAIL_RANGE: [number, number] = [2, 4];
    const tracker = await installSupabaseRoutes(page, async (route, idx) => {
      await new Promise((r) => setTimeout(r, 100));
      if (idx >= FAIL_RANGE[0] && idx <= FAIL_RANGE[1]) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: ERROR_OCR_BODY,
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: okOcrBody(String(2330 + idx), `mock-${idx}`),
      });
    });
    await gotoTradeTab(page);

    await uploadFiles(page, ['ok.png', 'bad.png']);

    // 等批次結束（parseShot 對 bad.png 會做 3 次內部 retry，間隔 2s → ~6s）
    await expect(page.getByTestId('batch-cancel-btn')).toHaveCount(0, { timeout: 30_000 });

    await expect(
      page.locator('[data-testid="batch-item"][data-batch-name="ok.png"]'),
    ).toHaveAttribute('data-batch-status', 'success');
    await expect(
      page.locator('[data-testid="batch-item"][data-batch-name="bad.png"]'),
    ).toHaveAttribute('data-batch-status', 'failed');
    await expect(page.getByTestId('batch-retry-btn')).toBeVisible();

    const callsBeforeRetry = tracker.getCallCount();
    // 期望：ok 1 次 + bad 3 次 = 4
    expect(callsBeforeRetry).toBe(4);

    // 觸發重試
    await page.getByTestId('batch-retry-btn').click();

    // bad.png 重試成功（第 5 次呼叫）
    await expect(
      page.locator('[data-testid="batch-item"][data-batch-name="bad.png"]'),
    ).toHaveAttribute('data-batch-status', 'success', { timeout: 15_000 });

    // ok.png 不應被重跑
    await expect(
      page.locator('[data-testid="batch-item"][data-batch-name="ok.png"]'),
    ).toHaveAttribute('data-batch-status', 'success');

    const callsAfterRetry = tracker.getCallCount();
    expect(callsAfterRetry).toBe(callsBeforeRetry + 1); // 只多 1 次（bad.png retry）
  });
});
