/**
 * Regression: 彥愷（sharkgu）4576 大銀微系統（2026-07-17）
 *
 * 老師先發 buy 1 張，再發 add 999 股，並在後台把先前誤發的 pending trim 1 張刪掉。
 * 舊 bug：匯出檔會出現「賣出 1 張」，或把「1 張」與「999 股」硬相加造成單位錯亂。
 *
 * 本測試用 harness 固定 fixture 匯出實際 markdown，斷言：
 *   1) 4576 段落只有 buy + add 兩筆，無 sell / trim / exit
 *   2) 全檔不出現「賣出股數：1 張」
 *   3) 本週總計「總買進股數」= 1 張（add 999 股不會被誤加進去）
 *   4) 本週總計「總賣出股數」= 0 股
 */
import { test, expect } from '@playwright/test';

const HARNESS_URL = '/e2e/journals-export-harness';
const EXPECTED_FILENAME =
  'legendflow-journal-sharkgu-2026-07-13_to_2026-07-19_published.md';

test('彥愷 4576：buy 1 張 + add 999 股，匯出檔無「賣出 1 張」、單位不錯亂', async ({ page }) => {
  await page.goto(HARNESS_URL);
  await expect(page.getByTestId('je-status')).toHaveText('idle');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('je-export-yankai-4576').click(),
  ]);
  expect(download.suggestedFilename()).toBe(EXPECTED_FILENAME);

  const fs = await import('node:fs/promises');
  const p = await download.path();
  expect(p).toBeTruthy();
  const md = await fs.readFile(p!, 'utf8');

  // 基本 header
  expect(md).toContain('# 彥愷 週記');
  expect(md).toContain('- Slug：`sharkgu`');
  expect(md).toContain('- 則數：2');

  // 4576 兩筆 row 的動作／單位
  expect(md).toContain('動作：buy');
  expect(md).toContain('買進股數：1 張');
  expect(md).toContain('動作：add');
  expect(md).toContain('數量股數：999 股');

  // 全檔絕對不能出現的組合
  expect(md).not.toMatch(/賣出股數：1 張/);
  expect(md).not.toMatch(/動作：sell/);
  expect(md).not.toMatch(/動作：trim/);
  expect(md).not.toMatch(/動作：exit/);

  // 4576 兩個段落內部各自不得含「賣出」字樣
  const parts = md.split(/^## \d+\. /m).slice(1); // 跳過 header
  const yk4576 = parts.filter((s) => s.includes('4576'));
  expect(yk4576.length).toBe(2);
  for (const seg of yk4576) {
    expect(seg).not.toContain('賣出');
    expect(seg).not.toContain('sell');
    expect(seg).not.toContain('trim');
    expect(seg).not.toContain('exit');
  }

  // 本週總計：買進只算 buy（1 張），add 不併入；賣出為 0
  const totals = md.slice(md.indexOf('## 本週總計'));
  expect(totals).toContain('- 總買進股數：1 張');
  expect(totals).toContain('- 總賣出股數：0 股');
  // 明確禁止的錯亂輸出
  expect(totals).not.toMatch(/總買進股數：1000 股/);
  expect(totals).not.toMatch(/總買進股數：1000 張/);
  expect(totals).not.toMatch(/總買進股數：999 股/);
  expect(totals).not.toMatch(/總賣出股數：1 張/);
  expect(totals).not.toContain('依單位分列'); // 只有一種單位（張），不該觸發分列

  await expect(page.getByTestId('je-status'))
    .toHaveText(`yankai-4576:single:${EXPECTED_FILENAME}`);
});
