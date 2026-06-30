import { test, expect, type Page } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';

/**
 * FreeCheckup 批次上限 — 一次最多 10 張
 *
 * 驗證上傳 > 10 張時：
 *   - 出現「一次最多上傳 10 張截圖」錯誤提示（toast）
 *   - 不會啟動批次解析（BatchParsePanel 不出現、checkup-parse 0 次呼叫）
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

test('上傳 > 10 張：顯示上限提示，不啟動批次解析', async ({ page }) => {
  await setupAuthenticated(page);
  let parseCalls = 0;
  await page.route(`https://${SUPABASE_HOST}/**`, async (route) => {
    const url = route.request().url();
    if (url.includes('/functions/v1/checkup-parse')) {
      parseCalls += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text: '{"trades":[]}' }] }) });
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

  // 生 11 張檔案
  const files = Array.from({ length: 11 }, (_, i) => ({
    name: `over-${i + 1}.png`, mimeType: 'image/png', buffer: PNG_1x1,
  }));
  await page.locator('#fi').setInputFiles(files);

  // toast 出現「一次最多上傳 10 張」
  await expect(page.getByText(/一次最多上傳\s*10\s*張/)).toBeVisible({ timeout: 5_000 });

  // 給一段時間確認不會偷偷啟動批次
  await page.waitForTimeout(1000);

  // BatchParsePanel 不出現
  await expect(page.getByTestId('batch-parse-panel')).toHaveCount(0);
  // checkup-parse 0 次呼叫
  expect(parseCalls).toBe(0);
});
