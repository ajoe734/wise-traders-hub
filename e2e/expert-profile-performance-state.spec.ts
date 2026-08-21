import { expect, test } from '@playwright/test';

const SENSITIVE_TABLES = ['trade_records', 'expert_signals', 'payment_settings', 'subscriptions'];
const FAIL_CLOSED_COPY = ['尚無可公開紀錄', '資料暫時無法取得'];

test('master-brian live route always mounts a visible performance state', async ({ page }) => {
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];
  const sensitiveRequests: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
  });
  page.on('request', (request) => {
    if (SENSITIVE_TABLES.some((table) => request.url().includes(table))) {
      sensitiveRequests.push(request.url());
    }
  });

  await page.goto('/expert/master-brian?refresh=performance-parent-contract', {
    waitUntil: 'networkidle',
  });
  await page.reload({ waitUntil: 'networkidle' });

  const section = page
    .getByRole('heading', { name: '績效總覽' })
    .locator('xpath=ancestor::section[1]');
  await expect(section).toBeVisible();
  await expect
    .poll(async () => (await section.innerText()).trim())
    .not.toBe('績效總覽');

  const text = await section.innerText();
  expect(FAIL_CLOSED_COPY.some((copy) => text.includes(copy))).toBe(true);
  expect(text).not.toMatch(/(?:^|\s)[+-]?0(?:\.00)?%(?:\s|$)/);
  expect(consoleErrors).toEqual([]);
  expect(failedResponses).toEqual([]);
  expect(sensitiveRequests).toEqual([]);
});