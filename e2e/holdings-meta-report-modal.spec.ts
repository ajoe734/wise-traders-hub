// HoldingMetaReportModal — 從 HoldingCard「回報」按鈕開啟後：
//   1. 對話框 role/aria + 標題 + 4 個 Field label（產業/營收比重/題材/策略）齊備
//   2. C10（audit 2026-07）主題色符合 theme.js `L` token：
//        bg=#F5F3EF、text=#292520、儲存按鈕反白 bg=#292520 / color=#F5F3EF
//   3. 「取消」關閉、以及 ESC 關閉，兩條路徑 modal 都會消失
// 若 C10 有人把顏色改回硬編碼 hex 或改壞 token，本測試會炸。
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

test.describe('HoldingMetaReportModal — 開/關 + C10 theme token', () => {
  test.beforeEach(async ({ page }) => {
    await setupDemo(page);
    await gotoWithRetry(page, '/holding-checkup-demo', { waitUntil: 'domcontentloaded' });
    await page.locator('.wb-card').first().waitFor({ state: 'visible', timeout: 15_000 });
  });

  test('開啟後：aria + 標題 + 4 個 Field label + 主題色 token 全部命中', async ({ page }) => {
    const dialog = await openModal(page);

    // aria
    await expect(dialog).toHaveAttribute('aria-modal', 'true');

    // 標題含「回報分類 —」
    await expect(dialog.getByText(/^回報分類 —/)).toBeVisible();

    // 四個 Field label 齊備
    for (const label of ['產業', '營收比重', '題材', '策略']) {
      await expect(dialog.getByText(new RegExp(`^${label}`))).toBeVisible();
    }

    // 隱私提示
    await expect(dialog.getByText(/你回報的分類只影響你自己的帳號/)).toBeVisible();

    // role="dialog" 在外層 backdrop（半透明黑）；內層 card 才是 C.bg 底
    const backdrop = dialog;
    await expect(backdrop).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.35)');
    const inner = dialog.locator(':scope > div').first();
    await expect(inner).toHaveCSS('background-color', TOKEN_BG);

    // 標題文字色 = L.text（第一段標題 div）
    const title = dialog.getByText(/^回報分類 —/);
    await expect(title).toHaveCSS('color', TOKEN_TEXT);

    // 「儲存」按鈕反白：bg=L.text、color=L.bg
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
    // backdrop 在 dialog 外圍；用 page.mouse 點擊視窗左上角空白（backdrop 位於 fixed inset:0）
    await page.mouse.click(10, 10);
    await expect(dialog).toHaveCount(0, { timeout: 3_000 });
  });

  test('關閉後再次開啟：仍能命中 aria + Field label（狀態未殘留）', async ({ page }) => {
    const dialog1 = await openModal(page);
    await page.keyboard.press('Escape');
    await expect(dialog1).toHaveCount(0, { timeout: 3_000 });

    const dialog2 = await openModal(page);
    await expect(dialog2).toHaveAttribute('aria-modal', 'true');
    await expect(dialog2.getByText(/^回報分類 —/)).toBeVisible();
    for (const label of ['產業', '營收比重', '題材', '策略']) {
      await expect(dialog2.getByText(new RegExp(`^${label}`))).toBeVisible();
    }
  });
});
