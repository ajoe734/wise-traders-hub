// 窄螢幕（863px）防回歸：
//   - 點持倉卡 → 一定要展開新版 HoldingsDetailPanel（不是 legacy overlay）
//   - ComparisonCharts、ExportMenu（三段 segmented + 立即匯出）皆可見
//   - 看不到 legacy overlay 的「返回列表 / 來自：」文案
//   - 切換 Ratio/Format/Resolution 會即時寫入 localStorage('holdingPanel.export.v1')
import { test, expect, type Page } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';

const NARROW = { width: 863, height: 900 };
const EXPORT_PREFS_KEY = 'holdingPanel.export.v1';

async function setupDemo(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('checkup-coach-seen-v1', '1');
      window.localStorage.setItem('holdings-intro-video-seen-v2', '1');
      window.localStorage.setItem('lf.checkup.onboarded', '1');
      window.sessionStorage.setItem('holdings-intro-video-dismissed-session', '1');
      window.localStorage.setItem('checkup-onboarding-tour-v1', 'done');
      window.localStorage.removeItem('holdingPanel.export.v1');
    } catch {}
  });
}

test.describe('Holdings detail panel @ 863px (narrow viewport)', () => {
  test.use({ viewport: NARROW });

  test.beforeEach(async ({ page }) => {
    await setupDemo(page);
    // 走 demo entry，避免 preview 環境 ?demo=1 被吃掉
    await gotoWithRetry(page, '/holding-checkup-demo', { waitUntil: 'domcontentloaded' });
    await page.locator('.wb-card').first().waitFor({ state: 'visible', timeout: 15_000 });
  });

  test('單擊持倉卡 → 展開新版 HoldingsDetailPanel（§4）+ 建議印章行 + ExportMenu', async ({ page }) => {
    await page.locator('.wb-card').first().click();

    const panel = page.locator('[data-testid="holdings-detail-panel"]');
    await expect(panel).toBeVisible({ timeout: 10_000 });

    await expect(page.getByText('返回列表', { exact: false })).toHaveCount(0);
    await expect(page.getByText('來自：', { exact: false })).toHaveCount(0);

    const hint = page.locator('[data-testid="holdings-panel-narrow-hint"]');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('已展開完整圖表面板');

    // §4 刪除 & 新增
    await expect(panel.locator('[data-testid="holdings-comparison-charts"]')).toHaveCount(0);
    await expect(panel.locator('[data-testid="decision-stamp"]')).toBeVisible();
    await expect(panel.locator('[data-testid="decision-stamp"]')).toContainText('建議');

    const exportMenu = panel.locator('[data-testid="holdings-export-menu"]');
    await expect(exportMenu).toBeVisible();
    await exportMenu.click();
    await expect(page.locator('[data-testid="export-seg-ratio"]')).toBeVisible();
    await expect(page.locator('[data-testid="export-seg-format"]')).toBeVisible();
    await expect(page.locator('[data-testid="export-seg-resolution"]')).toBeVisible();
    await expect(page.locator('[data-testid="holding-export-trigger"]')).toBeVisible();
  });

  test('切換 Ratio/Format/Resolution 會即時持久化到 localStorage', async ({ page }) => {
    await page.locator('.wb-card').first().click();
    const panel = page.locator('[data-testid="holdings-detail-panel"]');
    await expect(panel).toBeVisible({ timeout: 10_000 });

    const exportMenu = panel.locator('[data-testid="holdings-export-menu"]');
    await exportMenu.click();

    await page.locator('[data-testid="export-seg-ratio"]')
      .getByRole('button', { name: /16:9/ }).click();
    await page.locator('[data-testid="export-seg-format"]')
      .getByRole('button', { name: /^PDF$/ }).click();
    await page.locator('[data-testid="export-seg-resolution"]')
      .getByRole('button', { name: /高\s*3x/ }).click();

    // C5：偏好以版本信封 { __v, data } 儲存（prefsStore），舊版裸物件仍相容。
    await expect.poll(async () => {
      return await page.evaluate((k) => {
        try {
          const raw = JSON.parse(window.localStorage.getItem(k) || '{}');
          return raw && typeof raw === 'object' && raw.data ? raw.data : raw;
        } catch { return {}; }
      }, EXPORT_PREFS_KEY);
    }, { timeout: 5_000 }).toMatchObject({ ratio: 'wide', format: 'pdf', resolution: 'high' });

    // 立即匯出按鈕文案應反映新組合（16:9 · PDF · 高 3x）
    const triggerText = await page.locator('[data-testid="holding-export-trigger"]').innerText();
    expect(triggerText).toMatch(/16:9/);
    expect(triggerText).toMatch(/PDF/);
    expect(triggerText).toMatch(/高 3x/);
  });
});
