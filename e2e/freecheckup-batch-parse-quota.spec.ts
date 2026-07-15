import { test, expect, type Page, type Route } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';

/**
 * FreeCheckup 批次解析 — 429 / QUOTA_EXCEEDED 錯誤呈現
 *
 * 驗證 checkup-parse 回 HTTP 429 + {error:'QUOTA_EXCEEDED'} 時：
 *   - parseShot 走 QUOTA 兜底分支，立即回 {ok:false,error:'QUOTA_EXCEEDED'}（不做 3 次 retry）
 *   - 對應檔案列在 BatchParsePanel 內以 status=failed + 錯誤訊息呈現
 *   - 其他正常檔案不受影響
 */

const SUPABASE_REF = 'yqacmrgdjlenbijclngi';
const SUPABASE_HOST = `${SUPABASE_REF}.supabase.co`;
const FAKE_USER_ID = '00000000-0000-0000-0000-000000000099';

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const makeFile = (name: string) => ({ name, mimeType: 'image/png', buffer: PNG_1x1 });

function okOcrBody(idx: number) {
  return JSON.stringify({
    content: [{ text: JSON.stringify({ trades: [{ action: '買進', code: String(2330 + idx), name: `mock-${idx}`, qty: 1, price: 100 }] }) }],
  });
}

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
      window.localStorage.setItem('lf.checkup.onboarded', '1');
      window.sessionStorage.setItem('holdings-intro-video-dismissed-session', '1');
      window.localStorage.removeItem('pf-holdings-v2');
    } catch {}
  }, { ref: SUPABASE_REF, userId: FAKE_USER_ID });
}

async function installRoutes(page: Page, parseHandler: (route: Route, i: number) => Promise<void>) {
  let calls = 0;
  await page.route(`https://${SUPABASE_HOST}/**`, async (route) => {
    const url = route.request().url();
    if (url.includes('/functions/v1/checkup-parse')) { calls += 1; return parseHandler(route, calls); }
    if (url.includes('/functions/v1/')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: [], content: [{ text: '{}' }] }) });
    if (url.includes('/auth/v1/user')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: FAKE_USER_ID, aud: 'authenticated', role: 'authenticated' }) });
    if (url.includes('/rest/v1/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    return route.continue();
  });
  return { getCalls: () => calls };
}

test('429 QUOTA_EXCEEDED：對應檔案顯示錯誤、其他檔案仍成功', async ({ page }) => {
  await setupAuthenticated(page);
  await installRoutes(page, async (route, idx) => {
    await new Promise((r) => setTimeout(r, 100));
    // 第 2 張回 429 QUOTA_EXCEEDED（會立即走兜底，不重試）
    if (idx === 2) {
      return route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'QUOTA_EXCEEDED', message: '配額已用完' }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: okOcrBody(idx) });
  });

  await gotoWithRetry(page, '/holding-checkup', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const tradeBtn = page.getByRole('button', { name: /^上傳成交$/ }).first();
  await expect(tradeBtn).toBeVisible({ timeout: 10_000 }); await tradeBtn.click();
  await page.waitForSelector('#fi', { state: 'attached', timeout: 15_000 });

  await page.locator('#fi').setInputFiles([makeFile('ok-a.png'), makeFile('quota.png'), makeFile('ok-b.png')]);

  // 等批次跑完
  await expect(page.getByTestId('batch-parse-panel')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('batch-cancel-btn')).toHaveCount(0, { timeout: 20_000 });

  // ok-a / ok-b 成功
  await expect(page.locator('[data-testid="batch-item"][data-batch-name="ok-a.png"]'))
    .toHaveAttribute('data-batch-status', 'success');
  await expect(page.locator('[data-testid="batch-item"][data-batch-name="ok-b.png"]'))
    .toHaveAttribute('data-batch-status', 'success');

  // quota.png 失敗 + 錯誤訊息顯示 QUOTA_EXCEEDED
  const quotaItem = page.locator('[data-testid="batch-item"][data-batch-name="quota.png"]');
  await expect(quotaItem).toHaveAttribute('data-batch-status', 'failed');
  await expect(quotaItem.getByTestId('batch-item-error')).toContainText(/QUOTA_EXCEEDED|配額/);

  // 「重試失敗」按鈕出現
  await expect(page.getByTestId('batch-retry-btn')).toBeVisible();
});
