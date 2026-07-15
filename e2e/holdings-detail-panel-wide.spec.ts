// 寬螢幕（1280px）防回歸：
//   - 點持倉卡 → 一定要展開新版 HoldingsDetailPanel（不是 legacy overlay）
//   - ComparisonCharts、ExportMenu（三段 segmented + 立即匯出）皆可見
//   - 看不到 legacy overlay 的「返回列表 / 來自：」文案
//   - 窄螢幕專用提示帶（narrow-hint）在 1280px 隱藏
import { test, expect, type Page } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';

const WIDE = { width: 1280, height: 900 };

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

test.describe('Holdings detail panel @ 1280px (wide viewport)', () => {
  test.use({ viewport: WIDE });

  test.beforeEach(async ({ page }) => {
    await setupDemo(page);
    await gotoWithRetry(page, '/holding-checkup-demo', { waitUntil: 'domcontentloaded' });
    await page.locator('.wb-card').first().waitFor({ state: 'visible', timeout: 15_000 });
  });

  test('單擊持倉卡 → 顯示新版 HoldingsDetailPanel（§4）+ 建議印章行 + ExportMenu', async ({ page }) => {
    await page.locator('.wb-card').first().click();

    const panel = page.locator('[data-testid="holdings-detail-panel"]');
    await expect(panel).toBeVisible({ timeout: 10_000 });

    // legacy overlay drawer 文案不該出現
    await expect(page.getByText('返回列表', { exact: false })).toHaveCount(0);
    await expect(page.getByText('來自：', { exact: false })).toHaveCount(0);

    // 窄螢幕提示帶在寬螢幕應隱藏
    const hint = page.locator('[data-testid="holdings-panel-narrow-hint"]');
    await expect(hint).toBeHidden();

    // §4 刪除：ComparisonCharts / 甜甜圈 / 英文 DECISION 盒
    await expect(panel.locator('[data-testid="holdings-comparison-charts"]')).toHaveCount(0);
    await expect(panel.getByText(/^DECISION$/)).toHaveCount(0);
    await expect(panel.getByText(/^RETURN$/)).toHaveCount(0);
    await expect(panel.getByText(/^TARGET$/)).toHaveCount(0);

    // §4 新增：建議印章行（中文「建議」+ 急迫度）
    await expect(panel.locator('[data-testid="decision-stamp"]')).toBeVisible();
    await expect(panel.locator('[data-testid="decision-stamp"]')).toContainText('建議');
    await expect(panel.locator('[data-testid="decision-stamp"]')).toContainText('急迫度');

    // ExportMenu 與三段 segmented + 立即匯出按鈕（功能保留）
    const exportMenu = panel.locator('[data-testid="holdings-export-menu"]');
    await expect(exportMenu).toBeVisible();
    await exportMenu.click();
    await expect(page.locator('[data-testid="export-seg-ratio"]')).toBeVisible();
    await expect(page.locator('[data-testid="export-seg-format"]')).toBeVisible();
    await expect(page.locator('[data-testid="export-seg-resolution"]')).toBeVisible();
    await expect(page.locator('[data-testid="holding-export-trigger"]')).toBeVisible();
  });
});
