import { test, expect } from '@playwright/test';

const HARNESS_URL = '/e2e/journals-export-harness';

/**
 * 同一位老師同時有「張」與「股」兩種 quantity_unit 時，「本週總計」
 * 必須以分段標註方式清楚呈現，不能被合併成 "N 張、M 股" 一行。
 *
 * Fixture (MENTOR_D_ROWS, 見 src/pages/JournalsExportHarnessEntry.tsx)：
 *   buy  : 2 張 + 500 股
 *   sell : 1 張 + 300 股
 */
test('雙單位老師的本週總計 → 依單位分列顯示', async ({ page }) => {
  await page.goto(HARNESS_URL);
  await expect(page.getByTestId('je-status')).toHaveText('idle');

  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('je-export-dual-unit').click(),
  ]);
  const p = await dl.path();
  expect(p).toBeTruthy();
  const fs = await import('node:fs/promises');
  const md = await fs.readFile(p!, 'utf8');

  expect(dl.suggestedFilename()).toContain('dual-unit-master');

  expect(md.match(/## 本週總計/g)?.length).toBe(1);

  const totalsBlock = md.slice(md.indexOf('## 本週總計'));

  // 新格式：`- 進場側合計 (buy + add)(...)（依單位分列，未換算）：` + 兩個子項目
  expect(totalsBlock).toMatch(/- 進場側合計 \(buy \+ add\)（[^）]*）（依單位分列，未換算）：/);
  expect(totalsBlock).toContain('  - 500 股');
  expect(totalsBlock).toContain('  - 2 張');

  expect(totalsBlock).toMatch(/- 出場側合計 \(sell \+ trim \+ exit\)（[^）]*）（依單位分列，未換算）：/);
  expect(totalsBlock).toContain('  - 300 股');
  expect(totalsBlock).toContain('  - 1 張');

  // 禁止把兩種單位合併成一行
  expect(totalsBlock).not.toMatch(/進場側合計[^\n]*：\s*2 張、500 股/);
  expect(totalsBlock).not.toMatch(/進場側合計[^\n]*：\s*500 股、2 張/);
  expect(totalsBlock).not.toMatch(/出場側合計[^\n]*：\s*1 張、300 股/);
  expect(totalsBlock).not.toMatch(/出場側合計[^\n]*：\s*300 股、1 張/);

  await expect(page.getByTestId('je-status'))
    .toHaveText(/^dual-unit:single:legendflow-journal-dual-unit-master-/);
});

test('單一單位（老周只有張）→ 維持一行格式，不觸發分列', async ({ page }) => {
  await page.goto(HARNESS_URL);
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('je-export-single').click(),
  ]);
  const p = await dl.path();
  const fs = await import('node:fs/promises');
  const md = await fs.readFile(p!, 'utf8');
  const totalsBlock = md.slice(md.indexOf('## 本週總計'));

  expect(totalsBlock).toMatch(/- 進場側合計 \(buy \+ add\)（[^）]*）：2 張/);
  expect(totalsBlock).toMatch(/- 出場側合計 \(sell \+ trim \+ exit\)（[^）]*）：1 張/);
  expect(totalsBlock).not.toContain('依單位分列');
});
