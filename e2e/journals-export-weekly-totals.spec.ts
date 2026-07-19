import { test, expect } from '@playwright/test';
import JSZip from 'jszip';

const HARNESS_URL = '/e2e/journals-export-harness';

/**
 * Regression: 每位老師匯出檔尾端的「本週總計」必須完全對應 fixture 資料。
 *
 * Fixtures（見 src/pages/JournalsExportHarnessEntry.tsx）：
 *   老周 (master-zhou)      buy 2 張,  sell 1 張
 *   Wendy (wendy-us)        buy 50 股, (無賣出)
 *   助教小陳 (assistant-chen) buy 3+7=10 股（含空字串/null 單位）
 *                            sell 5+9=14 股（含 undefined/whitespace 單位）
 */

async function readSingle(page: import('@playwright/test').Page, buttonTestId: string) {
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId(buttonTestId).click(),
  ]);
  const p = await dl.path();
  expect(p).toBeTruthy();
  const fs = await import('node:fs/promises');
  return { filename: dl.suggestedFilename(), md: await fs.readFile(p!, 'utf8') };
}

async function readZip(page: import('@playwright/test').Page, buttonTestId: string) {
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId(buttonTestId).click(),
  ]);
  const p = await dl.path();
  expect(p).toBeTruthy();
  const fs = await import('node:fs/promises');
  const buf = await fs.readFile(p!);
  const zip = await JSZip.loadAsync(buf);
  const files: Record<string, string> = {};
  for (const name of Object.keys(zip.files)) {
    files[name] = await zip.files[name].async('string');
  }
  return { filename: dl.suggestedFilename(), files };
}

function extractWeeklyTotals(md: string): { buy: string; sell: string } {
  const idx = md.indexOf('## 本週總計');
  expect(idx, '每份匯出檔必須包含「## 本週總計」段落').toBeGreaterThan(-1);
  const tail = md.slice(idx);
  const buy = tail.match(/^- 總買進股數：(.+)$/m)?.[1]?.trim() ?? '';
  const sell = tail.match(/^- 總賣出股數：(.+)$/m)?.[1]?.trim() ?? '';
  return { buy, sell };
}

test.describe('Journals export — 本週總計 vs fixture', () => {
  test('老周（單一老師）：買 2 張 / 賣 1 張', async ({ page }) => {
    await page.goto(HARNESS_URL);
    await expect(page.getByTestId('je-status')).toHaveText('idle');
    const { md } = await readSingle(page, 'je-export-single');
    // 總計段落只應該出現一次
    expect(md.match(/## 本週總計/g)?.length).toBe(1);
    const totals = extractWeeklyTotals(md);
    expect(totals.buy).toBe('2 張');
    expect(totals.sell).toBe('1 張');
  });

  test('多位老師：老周（2/1 張）+ Wendy（50 股買、無賣出）各自獨立', async ({ page }) => {
    await page.goto(HARNESS_URL);
    const { files } = await readZip(page, 'je-export-multi');

    const mdZhou = files['master-zhou.md'];
    const mdWendy = files['wendy-us.md'];
    expect(mdZhou).toBeTruthy();
    expect(mdWendy).toBeTruthy();

    const tZhou = extractWeeklyTotals(mdZhou);
    expect(tZhou.buy).toBe('2 張');
    expect(tZhou.sell).toBe('1 張');
    // 沒有 Wendy 的股數滲入
    expect(tZhou.buy).not.toContain('股');
    expect(tZhou.sell).not.toContain('股');

    const tWendy = extractWeeklyTotals(mdWendy);
    expect(tWendy.buy).toBe('50 股');
    // 無賣出 → 預設「0 股」
    expect(tWendy.sell).toBe('0 股');
    expect(tWendy.buy).not.toContain('張');
    expect(tWendy.sell).not.toContain('張');
  });

  test('助教小陳（空/缺/null/whitespace 單位一律回退為 股）：買 10 股 / 賣 14 股', async ({ page }) => {
    await page.goto(HARNESS_URL);
    const { md } = await readSingle(page, 'je-export-empty-unit');
    const totals = extractWeeklyTotals(md);
    // buy: 3 + 7 = 10 股；sell: 5 + 9 = 14 股
    expect(totals.buy).toBe('10 股');
    expect(totals.sell).toBe('14 股');
    // 確認不會出現其他單位或空白
    expect(totals.buy).not.toContain('張');
    expect(totals.sell).not.toContain('張');
    expect(totals.buy).not.toMatch(/\s{2,}股/);
  });

  test('混合單位（老周 張 + 助教小陳 股）：各檔總計獨立、單位不互相污染', async ({ page }) => {
    await page.goto(HARNESS_URL);
    const { files } = await readZip(page, 'je-export-multi-mixed');

    const mdZhou = files['master-zhou.md'];
    const mdChen = files['assistant-chen.md'];
    expect(mdZhou).toBeTruthy();
    expect(mdChen).toBeTruthy();

    const tZhou = extractWeeklyTotals(mdZhou);
    expect(tZhou.buy).toBe('2 張');
    expect(tZhou.sell).toBe('1 張');
    // 老周檔內總計不得混入「股」單位（僅檢查總計段落）
    const zhouTotalsBlock = mdZhou.slice(mdZhou.indexOf('## 本週總計'));
    expect(zhouTotalsBlock).not.toContain('股');

    const tChen = extractWeeklyTotals(mdChen);
    expect(tChen.buy).toBe('10 股');
    expect(tChen.sell).toBe('14 股');
    const chenTotalsBlock = mdChen.slice(mdChen.indexOf('## 本週總計'));
    expect(chenTotalsBlock).not.toContain('張');
  });
});
