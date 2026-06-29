/**
 * 分享下拉選單（ShareButton on /expert/:slug）：
 *  1. 點「複製連結」→ 顯示「已複製」狀態（clipboard write 成功）
 *  2. 點「顯示 QR Code」→ QR Dialog 開啟、<img> src 為 qrserver.com 帶 canonical URL
 *  3. 點「下載 PNG」→ 觸發瀏覽器 download，檔案能落地且非空
 *
 * QR PNG 透過 page.route() mock 成本地 1×1 PNG，避免依賴外部 qrserver.com。
 */
import { test, expect } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';

const SLUG = process.env.SHARE_EXPERT_SLUG || 'sharkgu';
const CANONICAL = `https://legendflow.tw/expert/${SLUG}`;

// 1×1 透明 PNG（base64）
const STUB_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64',
);

test.use({
  contextOptions: {
    permissions: ['clipboard-read', 'clipboard-write'],
  },
});

test.beforeEach(async ({ context }) => {
  // 攔截外部 QR API → 回 stub PNG
  await context.route('**/api.qrserver.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: STUB_PNG,
    });
  });
});

async function openShareMenu(page: import('@playwright/test').Page) {
  await gotoWithRetry(page, `/expert/${SLUG}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  const trigger = page.getByRole('button', { name: /分享/ }).first();
  await trigger.waitFor({ state: 'visible', timeout: 15_000 });
  await trigger.click();
}

test('複製連結後按鈕顯示已複製，且 clipboard 內容為 canonical URL', async ({ page }) => {
  await openShareMenu(page);
  await page.getByRole('menuitem', { name: /複製連結/ }).click();

  // 按鈕文字切到「已複製」
  await expect(page.getByRole('button', { name: /已複製/ })).toBeVisible({ timeout: 3_000 });

  // 驗 clipboard 真的寫入 canonical URL
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe(CANONICAL);
});

test('顯示 QR Code → Dialog 開啟，QR <img> 帶 canonical URL', async ({ page }) => {
  await openShareMenu(page);
  await page.getByRole('menuitem', { name: /顯示 QR Code/ }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  await expect(dialog.getByText('分享 QR Code')).toBeVisible();

  const qrImg = dialog.locator('img[alt="分享 QR Code"]');
  await expect(qrImg).toBeVisible();
  const src = await qrImg.getAttribute('src');
  expect(src).toContain('api.qrserver.com');
  expect(src).toContain(encodeURIComponent(CANONICAL));

  // 圖片載入成功（natural size > 0）
  const ok = await qrImg.evaluate(
    (el: HTMLImageElement) => el.complete && el.naturalWidth > 0,
  );
  expect(ok).toBe(true);
});

test('下載 QR PNG → 檔案能正常產生且非空', async ({ page }) => {
  await openShareMenu(page);
  await page.getByRole('menuitem', { name: /顯示 QR Code/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10_000 }),
    dialog.getByRole('button', { name: /下載 PNG/ }).click(),
  ]);

  expect(download.suggestedFilename()).toMatch(/legendflow.*\.png$/i);
  const path = await download.path();
  expect(path, 'download 落地路徑應存在').toBeTruthy();

  const fs = await import('node:fs');
  const size = fs.statSync(path!).size;
  expect(size, 'PNG 檔案不可為空').toBeGreaterThan(0);
});
