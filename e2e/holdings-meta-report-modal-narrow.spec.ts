// HoldingMetaReportModal — mobile (375) + narrow (863) 視口回歸：
//   1. 「回報」按鈕在小螢幕仍能開啟 modal
//   2. aria + 4 個 Field label + C10 theme token 三色不變
//   3. 取消 / ESC / backdrop / reopen 四條路徑在小螢幕都工作
// 對應 project：mobile-holdings-meta-report-modal (375) / narrow-holdings-meta-report-modal (863)
import { test, expect, type Page } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';

// theme.js L 對應
const TOKEN_BG = 'rgb(245, 243, 239)'; // #F5F3EF
const TOKEN_TEXT = 'rgb(41, 37, 32)';  // #292520

async function setupDemo(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('checkup-coach-seen-v1', '1');
      window.localStorage.setItem('holdings-intro-video-seen-v2', '1');
      window.localStorage.setItem('lf.checkup.onboarded', '1');
      window.sessionStorage.setItem('holdings-intro-video-dismissed-session', '1');
      window.localStorage.setItem('checkup-onboarding-tour-v1', 'done');
    } catch {}
  });
}

async function openModal(page: Page) {
  // §4：回報鈕已從卡片移到抽屜 sticky 操作列。先點卡片開抽屜，再點回報。
  const firstCard = page.locator('.wb-card').first();
  await firstCard.waitFor({ state: 'attached', timeout: 15_000 });
  await firstCard.scrollIntoViewIfNeeded();
  await firstCard.click();
  const panel = page.locator('[data-testid="holdings-detail-panel"]');
  await expect(panel).toBeVisible({ timeout: 10_000 });
  const reportBtn = panel.locator('button[title="回報分類錯誤"]').first();
  await reportBtn.waitFor({ state: 'visible', timeout: 10_000 });
  await reportBtn.click();
  const dialog = page.getByRole('dialog', { name: '回報分類錯誤' });
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  return dialog;
}

test.describe('HoldingMetaReportModal @ narrow/mobile — 開/關 + C10 theme token', () => {
  test.beforeEach(async ({ page }) => {
    await setupDemo(page);
    await gotoWithRetry(page, '/holding-checkup-demo', { waitUntil: 'domcontentloaded' });
    await page.locator('.wb-card').first().waitFor({ state: 'visible', timeout: 15_000 });
  });

  test('開啟後：aria + 標題 + 4 個 Field label + 主題色 token 全部命中', async ({ page }) => {
    const dialog = await openModal(page);

    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog.getByText(/^回報分類 —/)).toBeVisible();
    for (const label of ['產業', '營收比重', '題材', '策略']) {
      await expect(dialog.getByText(new RegExp(`^${label}`))).toBeVisible();
    }
    await expect(dialog.getByText(/你回報的分類只影響你自己的帳號/)).toBeVisible();

    const backdrop = dialog;
    await expect(backdrop).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.35)');
    const inner = dialog.locator(':scope > div').first();
    await expect(inner).toHaveCSS('background-color', TOKEN_BG);

    const title = dialog.getByText(/^回報分類 —/);
    await expect(title).toHaveCSS('color', TOKEN_TEXT);

    const saveBtn = dialog.getByRole('button', { name: '儲存' });
    await expect(saveBtn).toHaveCSS('background-color', TOKEN_TEXT);
    await expect(saveBtn).toHaveCSS('color', TOKEN_BG);
  });

  test('取消按鈕關閉：modal 消失', async ({ page }) => {
    const dialog = await openModal(page);
    await dialog.getByRole('button', { name: '取消' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 3_000 });
  });

  test('ESC 關閉：modal 消失', async ({ page }) => {
    const dialog = await openModal(page);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0, { timeout: 3_000 });
  });

  test('backdrop 點擊關閉：modal 消失', async ({ page }) => {
    const dialog = await openModal(page);
    // backdrop position:fixed inset:0，左上角一定是 backdrop 命中區
    await page.mouse.click(5, 5);
    await expect(dialog).toHaveCount(0, { timeout: 3_000 });
  });

  test('關閉後再次開啟：aria + Field label 齊備、輸入未存檔即拋棄', async ({ page }) => {
    const dialog1 = await openModal(page);
    const input1 = dialog1.locator('input[placeholder^="例："]').first();
    const initialValue = (await input1.inputValue()) ?? '';
    // 亂改一段，但不按儲存 → 直接 ESC 關閉
    await input1.fill(`${initialValue}__dirty_should_not_persist`);
    await expect(input1).toHaveValue(`${initialValue}__dirty_should_not_persist`);
    await page.keyboard.press('Escape');
    await expect(dialog1).toHaveCount(0, { timeout: 3_000 });

    const dialog2 = await openModal(page);
    await expect(dialog2).toHaveAttribute('aria-modal', 'true');
    await expect(dialog2.getByText(/^回報分類 —/)).toBeVisible();
    for (const label of ['產業', '營收比重', '題材', '策略']) {
      await expect(dialog2.getByText(new RegExp(`^${label}`))).toBeVisible();
    }
    // 未儲存的輸入應該被拋棄 → 值回到 initialValue（來自 currentMeta 初始化）
    const input2 = dialog2.locator('input[placeholder^="例："]').first();
    await expect(input2).toHaveValue(initialValue);
  });
});
