/**
 * Regression: 彥愷（sharkgu）4576 大銀微系統（2026-07-17）
 *
 * 老師先發 buy 1 張，再發 add 999 股，並在後台把先前誤發的 pending trim 1 張刪掉。
 * 舊 bug：匯出檔會出現「賣出 1 張」。新版本進場側合計 = buy + add，因為
 * 兩者單位不同（張 / 股），本週總計必須以「依單位分列」呈現，不做換算。
 */
import { test, expect } from '@playwright/test';

const HARNESS_URL = '/e2e/journals-export-harness';
const EXPECTED_FILENAME =
  'legendflow-journal-sharkgu-2026-07-13_to_2026-07-19_published.md';

test('彥愷 4576：buy 1 張 + add 999 股，匯出檔無「賣出」、單位獨立不換算', async ({ page }) => {
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

  // 4576 兩筆 row 的動作／單位（新版：中文動作 + `X數量：`）
  expect(md).toContain('動作：買進');
  expect(md).toContain('買進數量：1 張');
  expect(md).toContain('動作：加碼');
  expect(md).toContain('加碼數量：999 股');

  // 全檔絕對不能出現的組合
  expect(md).not.toMatch(/賣出數量：1 張/);
  expect(md).not.toMatch(/動作：賣出/);
  expect(md).not.toMatch(/動作：減碼/);
  expect(md).not.toMatch(/動作：出場/);

  // 4576 兩個段落內部各自不得含「賣出」字樣
  const parts = md.split(/^## \d+\. /m).slice(1);
  const yk4576 = parts
    .filter((s) => s.includes('4576'))
    .map((s) => s.split(/^> 訊號 ID/m)[0]);
  expect(yk4576.length).toBe(2);
  for (const seg of yk4576) {
    expect(seg).not.toContain('賣出');
    expect(seg).not.toContain('sell');
    expect(seg).not.toContain('trim');
    expect(seg).not.toContain('exit');
  }

  // 本週總計：進場側 = buy 1 張 + add 999 股，因單位不同 → 依單位分列
  const totals = md.slice(md.indexOf('## 本週總計'));
  expect(totals).toMatch(/- 進場側合計 \(buy \+ add\)（[^）]*）（依單位分列，未換算）：/);
  expect(totals).toContain('  - 1 張');
  expect(totals).toContain('  - 999 股');
  // 出場側 = 無
  expect(totals).toMatch(/- 出場側合計 \(sell \+ trim \+ exit\)：無/);
  // 明確禁止的錯亂輸出
  expect(totals).not.toMatch(/進場側合計[^\n]*：1000 股/);
  expect(totals).not.toMatch(/進場側合計[^\n]*：1000 張/);
  expect(totals).not.toMatch(/出場側合計[^\n]*：1 張/);

  await expect(page.getByTestId('je-status'))
    .toHaveText(`yankai-4576:single:${EXPECTED_FILENAME}`);
});
