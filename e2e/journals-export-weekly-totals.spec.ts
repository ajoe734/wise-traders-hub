import { test, expect } from '@playwright/test';
import JSZip from 'jszip';

const HARNESS_URL = '/e2e/journals-export-harness';

/**
 * Regression: 每位老師匯出檔尾端的「本週總計」必須完全對應 fixture 資料。
 *
 * Fixtures（見 src/pages/JournalsExportHarnessEntry.tsx）：
 *   老周 (master-zhou, tw_stock)      buy 2 張,  sell 1 張
 *   Wendy (wendy-us, us_stock)        buy 50 股, (無出場)
 *   助教小陳 (assistant-chen, tw_stock) buy 3+7=10 張（含空字串/null 單位 → tw_stock 預設回退「張」）
 *                                       sell 5+9=14 張（含 undefined/whitespace 單位）
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

// 新版格式（單一單位）：
//   - 進場側合計 (buy + add)（買進 N 筆）：X 單位
//   - 出場側合計 (sell + trim + exit)（賣出 N 筆）：X 單位
// 若無資料：`- 進場側合計 (buy + add)：無`
function extractWeeklyTotals(md: string): { buy: string; sell: string } {
  const idx = md.indexOf('## 本週總計');
  expect(idx, '每份匯出檔必須包含「## 本週總計」段落').toBeGreaterThan(-1);
  const tail = md.slice(idx);
  const buy = tail.match(/^- 進場側合計 \(buy \+ add\)(?:（[^）]*）)?：(.+)$/m)?.[1]?.trim() ?? '';
  const sell = tail.match(/^- 出場側合計 \(sell \+ trim \+ exit\)(?:（[^）]*）)?：(.+)$/m)?.[1]?.trim() ?? '';
  return { buy, sell };
}

test.describe('Journals export — 本週總計 vs fixture', () => {
  test('老周（單一老師）：買 2 張 / 賣 1 張', async ({ page }) => {
    await page.goto(HARNESS_URL);
    await expect(page.getByTestId('je-status')).toHaveText('idle');
    const { md } = await readSingle(page, 'je-export-single');
    expect(md.match(/## 本週總計/g)?.length).toBe(1);
    const totals = extractWeeklyTotals(md);
    expect(totals.buy).toBe('2 張');
    expect(totals.sell).toBe('1 張');
  });

  test('多位老師：老周（2/1 張）+ Wendy（50 股買、無出場）各自獨立', async ({ page }) => {
    await page.goto(HARNESS_URL);
    const { files } = await readZip(page, 'je-export-multi');

    const mdZhou = files['master-zhou.md'];
    const mdWendy = files['wendy-us.md'];
    expect(mdZhou).toBeTruthy();
    expect(mdWendy).toBeTruthy();

    const tZhou = extractWeeklyTotals(mdZhou);
    expect(tZhou.buy).toBe('2 張');
    expect(tZhou.sell).toBe('1 張');
    expect(tZhou.buy).not.toContain('股');
    expect(tZhou.sell).not.toContain('股');

    const tWendy = extractWeeklyTotals(mdWendy);
    expect(tWendy.buy).toBe('50 股');
    // 無出場動作 → 新格式顯示「無」
    expect(tWendy.sell).toBe('無');
    expect(tWendy.buy).not.toContain('張');
  });

  test('助教小陳（空/缺/null/whitespace 單位一律回退為 tw_stock 預設「張」）：買 10 張 / 賣 14 張', async ({ page }) => {
    await page.goto(HARNESS_URL);
    const { md } = await readSingle(page, 'je-export-empty-unit');
    const totals = extractWeeklyTotals(md);
    // buy: 3 + 7 = 10 張；sell: 5 + 9 = 14 張（tw_stock 預設單位為「張」）
    expect(totals.buy).toBe('10 張');
    expect(totals.sell).toBe('14 張');
    expect(totals.buy).not.toContain('股');
    expect(totals.sell).not.toContain('股');
  });

  test('混合單位（老周 張 + 助教小陳 張）：各檔總計獨立、加總不跨檔', async ({ page }) => {
    await page.goto(HARNESS_URL);
    const { files } = await readZip(page, 'je-export-multi-mixed');

    const mdZhou = files['master-zhou.md'];
    const mdChen = files['assistant-chen.md'];
    expect(mdZhou).toBeTruthy();
    expect(mdChen).toBeTruthy();

    const tZhou = extractWeeklyTotals(mdZhou);
    expect(tZhou.buy).toBe('2 張');
    expect(tZhou.sell).toBe('1 張');

    const tChen = extractWeeklyTotals(mdChen);
    // 助教小陳所有 fixture 皆為 tw_stock → 預設回退「張」；數值加總 10 / 14 不跨檔混入老周的 2/1
    expect(tChen.buy).toBe('10 張');
    expect(tChen.sell).toBe('14 張');
  });
});
