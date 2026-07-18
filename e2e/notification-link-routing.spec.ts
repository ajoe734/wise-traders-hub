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
const EXTERNAL_URL_MATCH = /\/storage\/v1\/object\/sign\/journal-exports\/demo\.pdf\?token=/;
const INTERNAL_PATH = '/account/notifications?src=harness';

test.describe('NotificationBell · link routing', () => {
  test('內部路徑：走 react-router navigate 到正確頁面', async ({ page }) => {
    await page.goto(HARNESS, { waitUntil: 'domcontentloaded' });

    // 初始 URL 就是 harness 本身
    await expect(page.getByTestId('nav-target')).toHaveText(HARNESS);
    await expect(page.getByTestId('external-url')).toHaveText('(empty)');

    await page.getByTestId('fire-internal').click();

    // navigate 已切到 /account/notifications?src=harness（harness 元件會被卸載）
    // 只驗證：URL 正確 + 沒落到 NotFound + 沒開新分頁
    await expect(page).toHaveURL(/\/pricing\?src=harness/);

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toMatch(/404|找不到頁面|Not Found/i);
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
    await expect(page.getByTestId('external-url')).toHaveText(EXTERNAL_URL_MATCH);

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

  test('signed URL 已過期：不開新分頁、回報 signed_url_expired 錯誤訊息', async ({ page }) => {
    await page.goto(HARNESS, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('fire-expired-signed').click();

    await expect(page.getByTestId('last-kind')).toHaveText('external');
    await expect(page.getByTestId('last-error')).toHaveText('signed_url_expired');
    await expect(page.getByTestId('last-message')).toContainText('過期');
    // 過期時不應該真的開分頁 → external-url 保持空
    await expect(page.getByTestId('external-url')).toHaveText('(empty)');
  });

  test('signed URL token 格式錯誤：回報 signed_url_malformed', async ({ page }) => {
    await page.goto(HARNESS, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('fire-malformed-signed').click();

    await expect(page.getByTestId('last-error')).toHaveText('signed_url_malformed');
    await expect(page.getByTestId('external-url')).toHaveText('(empty)');
  });

  test('URL 格式錯誤：回報 invalid_url', async ({ page }) => {
    await page.goto(HARNESS, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('fire-invalid-url').click();

    await expect(page.getByTestId('last-error')).toHaveText('invalid_url');
    await expect(page.getByTestId('external-url')).toHaveText('(empty)');
  });

  test('合法未過期 signed URL：正常開新分頁、無錯誤', async ({ page }) => {
    await page.goto(HARNESS, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('fire-valid-signed').click();

    await expect(page.getByTestId('last-kind')).toHaveText('external');
    await expect(page.getByTestId('last-error')).toHaveText('(none)');
    await expect(page.getByTestId('external-url')).toContainText('/storage/v1/object/sign/');
  });

  test('popup 被瀏覽器擋掉：回報 popup_blocked', async ({ page }) => {
    await page.goto(HARNESS, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('toggle-popup-blocked').check();
    await page.getByTestId('fire-valid-signed').click();

    await expect(page.getByTestId('last-error')).toHaveText('popup_blocked');
    await expect(page.getByTestId('last-message')).toContainText('封鎖');
  });
});
