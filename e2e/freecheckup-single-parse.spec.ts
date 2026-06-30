import { test, expect, type Page } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';

/**
 * FreeCheckup 單張預覽 → 手動解析流程
 *
 * 驗證：
 *   - 上傳 1 張時不啟動 BatchParsePanel（沿用原有「預覽 + 手動點解析」UX）
 *   - 點「解析這筆交易」會呼叫一次 checkup-parse
 *   - 解析期間 BatchParsePanel 仍不渲染（單張模式不影響批次進度面板）
 */

const SUPABASE_REF = 'yqacmrgdjlenbijclngi';
const SUPABASE_HOST = `${SUPABASE_REF}.supabase.co`;
const FAKE_USER_ID = '00000000-0000-0000-0000-000000000099';

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

async function setupAuthenticated(page: Page) {
  await page.addInitScript(({ ref, userId }) => {
    try {
      const session = {
        access_token: 'fake-access-token', refresh_token: 'fake-refresh-token',
        token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600,
        expires_in: 3600, user: { id: userId, aud: 'authenticated', role: 'authenticated' },
      };
      window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session));
      window.localStorage.setItem('checkup-coach-seen-v1', '1');
      window.localStorage.setItem('holdings-intro-video-seen-v2', '1');
      window.sessionStorage.setItem('holdings-intro-video-dismissed-session', '1');
      window.localStorage.removeItem('pf-holdings-v2');
    } catch {}
  }, { ref: SUPABASE_REF, userId: FAKE_USER_ID });
}

test('單張上傳：手動點解析，BatchParsePanel 不出現', async ({ page }) => {
  await setupAuthenticated(page);
  let parseCalls = 0;
  await page.route(`https://${SUPABASE_HOST}/**`, async (route) => {
    const url = route.request().url();
    if (url.includes('/functions/v1/checkup-parse')) {
      parseCalls += 1;
      await new Promise((r) => setTimeout(r, 200));
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          content: [{ text: JSON.stringify({ trades: [{ action: '買進', code: '2330', name: '台積電', qty: 1, price: 600 }] }) }],
        }),
      });
    }
    if (url.includes('/functions/v1/')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: [], content: [{ text: '{}' }] }) });
    if (url.includes('/auth/v1/user')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: FAKE_USER_ID, aud: 'authenticated', role: 'authenticated' }) });
    if (url.includes('/rest/v1/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    return route.continue();
  });

  await gotoWithRetry(page, '/holding-checkup', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const tradeBtn = page.getByRole('button', { name: /^上傳成交$/ }).first();
  await expect(tradeBtn).toBeVisible({ timeout: 10_000 }); await tradeBtn.click();
  await page.waitForSelector('#fi', { state: 'attached', timeout: 15_000 });

  // 上傳「單一」檔案
  await page.locator('#fi').setInputFiles([{ name: 'single.png', mimeType: 'image/png', buffer: PNG_1x1 }]);

  // BatchParsePanel 永遠不出現
  await expect(page.getByTestId('batch-parse-panel')).toHaveCount(0);

  // 預覽圖出現後，「解析這筆交易」按鈕應可點
  const parseBtn = page.getByRole('button', { name: /解析這筆交易/ });
  await expect(parseBtn).toBeVisible({ timeout: 5_000 });
  expect(parseCalls).toBe(0); // 還沒點，不應該已經呼叫

  await parseBtn.click();

  // 解析期間 BatchParsePanel 仍不出現
  await expect(page.getByTestId('batch-parse-panel')).toHaveCount(0);

  // 等 checkup-parse 被呼叫恰好 1 次
  await expect.poll(() => parseCalls, { timeout: 10_000 }).toBe(1);

  // 解析完成後 BatchParsePanel 仍不應出現
  await page.waitForTimeout(500);
  await expect(page.getByTestId('batch-parse-panel')).toHaveCount(0);
});
