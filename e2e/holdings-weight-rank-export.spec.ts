// TDD seam 3：佔比排名摺疊狀態 + 匯出「包含佔比排名」開關
//   - 抽屜預設收合，展開後跨「關閉再開啟抽屜」仍記住
//   - 匯出選單開關關閉 → 寫入 localStorage，且匯出卡不再輸出「部位佔比」
import { test, expect, type Page } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';

const EXPORT_PREFS_KEY = 'holdingPanel.export.v1';
const PANEL_PREFS_KEY = 'holdingPanel.prefs.v1';

async function setupDemo(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('checkup-coach-seen-v1', '1');
      window.localStorage.setItem('holdings-intro-video-seen-v2', '1');
      window.localStorage.setItem('lf.checkup.onboarded', '1');
      window.sessionStorage.setItem('holdings-intro-video-dismissed-session', '1');
      window.localStorage.setItem('checkup-onboarding-tour-v1', 'done');
      window.localStorage.removeItem('holdingPanel.export.v1');
      window.localStorage.removeItem('holdingPanel.prefs.v1');
    } catch {}
  });
}

function readPrefs(page: Page, key: string) {
  return page.evaluate((k) => {
    try {
      const raw = JSON.parse(window.localStorage.getItem(k) || '{}');
      return raw && typeof raw === 'object' && raw.data ? raw.data : raw;
    } catch {
      return {};
    }
  }, key);
}

async function openFirstHolding(page: Page) {
  await page.locator('.wb-card').first().click();
  const panel = page.locator('[data-testid="holdings-detail-panel"]');
  await expect(panel).toBeVisible({ timeout: 10_000 });
  return panel;
}

test.describe('抽屜佔比排名：摺疊 + 匯出開關', () => {
  test.beforeEach(async ({ page }) => {
    await setupDemo(page);
    await gotoWithRetry(page, '/holding-checkup-demo', { waitUntil: 'domcontentloaded' });
    await page.locator('.wb-card').first().waitFor({ state: 'visible', timeout: 15_000 });
  });

  test('預設收合、展開後持久化，重開抽屜維持展開', async ({ page }) => {
    const panel = await openFirstHolding(page);

    const block = panel.locator('[data-testid="holdings-weight-rank"]').first();
    await expect(block).toBeVisible();
    await expect(panel.locator('[data-testid="holdings-weight-rank-bars"]')).toHaveCount(0);

    const toggle = panel.locator('[data-testid="holdings-weight-rank-toggle"]').first();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(panel.locator('[data-testid="holdings-weight-rank-bars"]')).toHaveCount(1);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await expect.poll(() => readPrefs(page, PANEL_PREFS_KEY), { timeout: 5_000 })
      .toMatchObject({ weightRankOpen: true });

    // 關閉抽屜後重開 → 記住展開狀態
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden({ timeout: 10_000 });
    const panel2 = await openFirstHolding(page);
    await expect(panel2.locator('[data-testid="holdings-weight-rank-bars"]')).toHaveCount(1);
  });

  test('佔比排名位於抽屜內容最下方（在情境模擬／論點之後）', async ({ page }) => {
    const panel = await openFirstHolding(page);
    const block = panel.locator('[data-testid="holdings-weight-rank"]').first();
    const band = panel.locator('[data-testid="holdings-range-band"]').first();

    const blockBox = (await block.boundingBox())!;
    const bandBox = (await band.boundingBox())!;
    expect(blockBox.y).toBeGreaterThan(bandBox.y);
  });

  // 匯出卡只在按下匯出的那一瞬間掛到離屏容器，用 MutationObserver 錄下曾出現的文字
  async function exportOnceAndCapture(page: Page): Promise<string> {
    await page.evaluate(() => {
      (window as any).__exportSeen = '';
      const obs = new MutationObserver(() => {
        const host = document.querySelector('[data-export-host]');
        if (host) (window as any).__exportSeen += host.textContent || '';
      });
      obs.observe(document.body, { childList: true, subtree: true });
      (window as any).__exportObs = obs;
    });
    const dl = page.waitForEvent('download', { timeout: 30_000 }).catch(() => null);
    await page.locator('[data-testid="holding-export-trigger"]').click();
    await dl;
    const seen = await page.evaluate(() => {
      (window as any).__exportObs?.disconnect();
      return (window as any).__exportSeen as string;
    });
    return seen;
  }

  test('匯出開關預設開啟 → 匯出卡含「部位佔比」', async ({ page }) => {
    const panel = await openFirstHolding(page);
    await panel.locator('[data-testid="holdings-export-menu"]').click();
    await expect(page.locator('[data-testid="export-toggle-weight-rank"]')).toBeVisible();

    expect(await exportOnceAndCapture(page)).toContain('部位佔比');
  });

  test('關閉開關後持久化，且匯出卡不再輸出「部位佔比」', async ({ page }) => {
    const panel = await openFirstHolding(page);
    await panel.locator('[data-testid="holdings-export-menu"]').click();
    await page.locator('[data-testid="export-toggle-weight-rank"]').click();

    await expect.poll(() => readPrefs(page, EXPORT_PREFS_KEY), { timeout: 5_000 })
      .toMatchObject({ includeWeightRank: false });

    await panel.locator('[data-testid="holdings-export-menu"]').click();
    expect(await exportOnceAndCapture(page)).not.toContain('部位佔比');
  });
});

