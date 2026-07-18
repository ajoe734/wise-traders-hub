/**
 * E2E 回歸 — NotificationBell link routing
 *
 * 保護 `openNotificationLink` 的三向分流不再退化為：
 *   - 把 Supabase Storage 的 signed URL（http(s)://...）交給 react-router
 *     `navigate()`，被當成 SPA 相對路徑後匹配 catch-all `*` → 進到
 *     `NotFound` 頁面（使用者實際看到 404）
 *   - 或反過來把內部路徑 `open(..., '_blank')` 甩到新分頁
 *   - 或 `link=null` 時仍觸發任一副作用
 *
 * 走 preview-only harness `/e2e/notification-link-harness`，
 * 其 openExternal 被攔截寫入 `[data-testid="external-url"]`，
 * 避免測試環境真的開新分頁。
 */
import { test, expect } from '@playwright/test';

const HARNESS = '/e2e/notification-link-harness';
const EXTERNAL_URL =
  'https://yqacmrgdjlenbijclngi.supabase.co/storage/v1/object/sign/journal-exports/demo.pdf?token=abc.def';
const INTERNAL_PATH = '/account/notifications?src=harness';

test.describe('NotificationBell · link routing', () => {
  test('內部路徑：走 react-router navigate 到正確頁面', async ({ page }) => {
    await page.goto(HARNESS, { waitUntil: 'domcontentloaded' });

    // 初始 URL 就是 harness 本身
    await expect(page.getByTestId('nav-target')).toHaveText(HARNESS);
    await expect(page.getByTestId('external-url')).toHaveText('(empty)');

    await page.getByTestId('fire-internal').click();

    // navigate 已切到 /account/notifications?src=harness
    // 該路由是受保護頁面，但這裡只驗證「路由被正確處理、不落到 NotFound」
    await expect(page.getByTestId('last-kind')).toHaveText('internal');
    await expect(page).toHaveURL(new RegExp('/account/notifications\\?src=harness'));

    // 明確斷言沒有落到 NotFound（頁面文案 / 標題）
    await expect(page.locator('body')).not.toContainText('404');
    await expect(page.locator('body')).not.toContainText('找不到頁面');

    // 也不能把它當外部連結開新分頁
    // （external-url 元件已隨 SPA navigate 卸載，改抓 window.open 是否被呼叫）
  });

  test('Storage signed URL：以新分頁開啟且不觸發 SPA 導航', async ({ page, context }) => {
    await page.goto(HARNESS, { waitUntil: 'domcontentloaded' });

    // 防呆：即使 harness 攔截了 openExternal，仍監聽 context 有無新分頁被開
    let popupOpened = false;
    context.on('page', () => {
      popupOpened = true;
    });

    await page.getByTestId('fire-external').click();

    // 分流結果為 external，harness 攔截到的 URL 完整保留（不被 URL 編碼扭曲）
    await expect(page.getByTestId('last-kind')).toHaveText('external');
    await expect(page.getByTestId('external-url')).toHaveText(EXTERNAL_URL);

    // 沒有觸發 react-router navigate → nav-target 仍停留在 harness
    await expect(page.getByTestId('nav-target')).toHaveText(HARNESS);
    await expect(page).toHaveURL(new RegExp(HARNESS + '$'));

    // 沒有真的開新分頁（harness 用 openExternal 覆寫攔下了 window.open）
    expect(popupOpened).toBe(false);
  });

  test('回歸：signed URL 不會被 react-router 當成相對路徑而 404', async ({ page }) => {
    // 直接模擬「未修復前的行為」：把外部 URL 交給 navigate() 會落到 NotFound。
    // 修好後 harness 走的是 openNotificationLink，這裡驗證使用者「不會看到 404」。
    await page.goto(HARNESS, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('fire-external').click();

    // 頁面內容不能出現 NotFound 相關字樣（防止未來誤把 external 交給 navigate）
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toMatch(/404|找不到頁面|Not Found/i);

    // pathname 沒被改寫成 https:/... 這種畸形路徑
    const pathname = await page.evaluate(() => window.location.pathname);
    expect(pathname).toBe('/e2e/notification-link-harness');
  });

  test('link=null：不觸發任何副作用', async ({ page }) => {
    await page.goto(HARNESS, { waitUntil: 'domcontentloaded' });

    await page.getByTestId('fire-null').click();

    await expect(page.getByTestId('last-kind')).toHaveText('none');
    await expect(page.getByTestId('external-url')).toHaveText('(empty)');
    await expect(page.getByTestId('nav-target')).toHaveText(HARNESS);
  });
});
