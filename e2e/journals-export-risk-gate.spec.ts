/**
 * Risk gate regression：週記匯出前的守門檢查
 *
 * 覆蓋 detectExportRisks 在 harness 上的三種情境：
 *   1) UNIT_MIX（block）→ 阻擋、無下載、report 呈現 blocked
 *   2) DIRECTION_NO_ENTRY（block）→ 阻擋、無下載
 *   3) warn-only（UNIT_MISSING）→ 仍下載
 *   4) 強制匯出 UNIT_MIX → 下載成功
 */
import { test, expect } from '@playwright/test';

const HARNESS_URL = '/e2e/journals-export-harness';

async function expectNoDownload(page: any, action: () => Promise<void>) {
  let downloaded = false;
  const off = () => { downloaded = true; };
  page.on('download', off);
  await action();
  // 給 UI 一點時間反應
  await page.waitForTimeout(500);
  page.off('download', off);
  expect(downloaded).toBe(false);
}

test('UNIT_MIX：被守門阻擋、無下載、狀態呈現 blocked', async ({ page }) => {
  await page.goto(HARNESS_URL);
  await expect(page.getByTestId('je-status')).toHaveText('idle');

  await expectNoDownload(page, async () => {
    await page.getByTestId('je-risk-unit-mix').click();
  });

  await expect(page.getByTestId('je-status')).toContainText('blocked:unit-mix');
  await expect(page.getByTestId('je-status')).toContainText('block=1');
  const report = await page.getByTestId('je-risk-report').textContent();
  expect(report).toContain('"blocked":true');
  expect(report).toContain('UNIT_MIX');
});

test('DIRECTION_NO_ENTRY：只賣未買也被阻擋', async ({ page }) => {
  await page.goto(HARNESS_URL);

  await expectNoDownload(page, async () => {
    await page.getByTestId('je-risk-no-entry').click();
  });

  await expect(page.getByTestId('je-status')).toContainText('blocked:no-entry');
  const report = await page.getByTestId('je-risk-report').textContent();
  expect(report).toContain('DIRECTION_NO_ENTRY');
});

test('warn-only：不阻擋，正常下載', async ({ page }) => {
  await page.goto(HARNESS_URL);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('je-risk-warn-only').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.md$/);
  await expect(page.getByTestId('je-status')).toContainText('passed:warn-only');
  const report = await page.getByTestId('je-risk-report').textContent();
  expect(report).toContain('"blocked":false');
  expect(report).toContain('UNIT_MISSING');
});

test('強制匯出：跳過守門直接下載', async ({ page }) => {
  await page.goto(HARNESS_URL);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('je-risk-force').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.md$/);
  await expect(page.getByTestId('je-status')).toContainText('forced:unit-mix');
});
