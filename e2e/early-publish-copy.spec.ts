/**
 * E2E — Early-publish → /app/ 通知呈現的「零下週」文案回歸
 *
 * 覆蓋 mentor-admin/signals 點擊「⚡ 提前開放本週發布」到訂閱者端
 * `/app/expert/{slug}` 通知呈現的整條入口鏈，並要求 TW / US 兩市場，
 * 所有出現在畫面上的字，都不得包含「下週」。
 *
 * Harness：/e2e/early-publish-copy-harness — 該頁面組合了：
 *   - Signals header 提示（Signals.tsx L204 同源）
 *   - 提前發布按鈕 title / label（Signals.tsx L214-221 同源）
 *   - `EarlyPublishDialog` 實際組件
 *   - AdminLayout side-nav hint / Dashboard 待辦提示
 *   - publish-weekly-journals edge function 對訂閱者寫入的 notifications
 *     title/body/link（同源常數）
 *
 * 若未來任何一處回退到「下週」，或提前發布按鈕消失，此測試會失敗。
 */
import { test, expect } from '@playwright/test';

const HARNESS = '/e2e/early-publish-copy-harness';

for (const market of ['tw', 'us'] as const) {
  const isTW = market === 'tw';
  const expectedMomentLabel = isTW ? '週五 20:00 統一開放發布' : '週六 08:00 統一開放發布';
  const expectedExpertName = isTW ? '老周' : 'Benny';
  const expectedSlug = isTW ? 'lao-zhou' : 'benny';

  test.describe(`早發布通知文案 · ${market.toUpperCase()} 市場`, () => {
    test(`從 signals 提前開放到 /app/ 通知呈現，全鏈無「下週」`, async ({ page }) => {
      await page.goto(HARNESS, { waitUntil: 'domcontentloaded' });

      const panel = page.getByTestId(`market-panel-${market}`);
      await expect(panel).toBeVisible();

      // 1) header 提示：包含本市場的統一開放時刻，且不得含「下週」
      const headerHint = page.getByTestId(`signals-header-hint-${market}`);
      await expect(headerHint).toContainText(`本${expectedMomentLabel}`);
      await expect(headerHint).not.toContainText('下週');

      // 2) AdminLayout side-nav hint — 統一為「本週五 20:00 統一開放發布」
      await expect(page.getByTestId(`sidenav-hint-${market}`)).toHaveText(
        '週記於每週五 20:00 統一開放發布',
      );

      // 3) Dashboard 待辦提示 — 明確「本週五」
      await expect(page.getByTestId(`dashboard-hint-${market}`)).toContainText(
        '本週五 20:00 統一開放發布',
      );

      // 4) 提前開放按鈕 label & title
      const btn = page.getByTestId(`early-publish-btn-${market}`);
      await expect(btn).toHaveText(/⚡\s*提前開放本週發布/);
      const title = await btn.getAttribute('title');
      expect(title).toContain(`繞過 本${expectedMomentLabel}`);
      expect(title).not.toContain('下週');

      // 5) 點擊開啟實際 EarlyPublishDialog（來自 production 組件）
      await btn.click();
      const dialogTitle = page.getByRole('alertdialog').getByText('提前開放本週發布？');
      await expect(dialogTitle).toBeVisible();

      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toContainText(`本${expectedMomentLabel}`);
      await expect(dialog).not.toContainText('下週');

      // 6) 確認提前發布 → 模擬 publish-weekly-journals 對訂閱者寫入的通知呈現
      await page.getByRole('button', { name: /確認提前發布/ }).click();

      const notif = page.getByTestId(`app-notification-${market}`);
      await expect(notif).toBeVisible();
      await expect(page.getByTestId(`app-notif-title-${market}`)).toHaveText(
        `${expectedExpertName} 本週週記已提前開放`,
      );
      await expect(page.getByTestId(`app-notif-body-${market}`)).toContainText('本週週記');
      await expect(page.getByTestId(`app-notif-link-${market}`)).toHaveAttribute(
        'href',
        `/app/expert/${expectedSlug}`,
      );

      // 7) 終極斷言：整條入口鏈 panel 內任何一處都不能出現「下週」
      const panelText = await panel.innerText();
      expect(panelText).not.toContain('下週');
    });
  });
}

test('整頁 harness 任何角落都不得出現「下週」', async ({ page }) => {
  await page.goto(HARNESS, { waitUntil: 'domcontentloaded' });

  // 觸發兩個市場的 dialog + 通知，確保「所有動態渲染出的內容」也被掃過
  for (const market of ['tw', 'us'] as const) {
    await page.getByTestId(`early-publish-btn-${market}`).click();
    await page.getByRole('button', { name: /確認提前發布/ }).click();
  }

  const fullText = await page.locator('body').innerText();
  expect(fullText).not.toContain('下週');
});
