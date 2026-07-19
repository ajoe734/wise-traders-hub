import { test, expect, type Page } from '@playwright/test';
import JSZip from 'jszip';

/**
 * Regression: 「- 週別：...」這一行在每份 mentor Markdown 中
 * 必須永遠位於固定位置 —— 緊接在 H1 標題 (`# {name} 週記`) 與一行
 * 空白之後（也就是第 3 行 / index 2），且後續 header 順序固定：
 *
 *   Line 1: # {name} 週記
 *   Line 2: (empty)
 *   Line 3: - 週別：YYYY-MM-DD ~ YYYY-MM-DD    ← 必須是 header 群的第 1 個 bullet
 *   Line 4: - Slug：`{slug}`
 *   Line 5: - 資產類別：{asset}
 *   Line 6: - 幣別：{currency}
 *   Line 7: - 則數：{count}
 *   Line 8: (empty)
 *   Line 9: ---
 *
 * 覆蓋範圍：
 *   1) 單一老師 .md 匯出
 *   2) multi zip（老周 + Wendy 美股）內每個 mentor 檔
 *   3) multi-mixed zip（老周 + 助教小陳）內每個 mentor 檔
 *   4) 覆寫週別（跨月）情況下位置不得漂移
 */

const HARNESS_URL = '/e2e/journals-export-harness';
const WEEK_LINE_RE = /^-\s*週別[：:]\s*\d{4}-\d{2}-\d{2}\s*~\s*\d{4}-\d{2}-\d{2}\s*$/;

const EXPECTED_HEADER_ORDER = [
  { idx: 2, name: 'week',     match: (l: string) => WEEK_LINE_RE.test(l) },
  { idx: 3, name: 'slug',     match: (l: string) => /^-\s*Slug[：:]\s*`.+`\s*$/.test(l) },
  { idx: 4, name: 'asset',    match: (l: string) => /^-\s*資產類別[：:]/.test(l) },
  { idx: 5, name: 'currency', match: (l: string) => /^-\s*幣別[：:]/.test(l) },
  { idx: 6, name: 'count',    match: (l: string) => /^-\s*則數[：:]\s*\d+\s*$/.test(l) },
];

function assertWeekLinePosition(md: string, ctx: string) {
  // 統一換行、避免 BOM
  const normalized = md.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  expect(lines.length, `[${ctx}] 檔案內容不得為空`).toBeGreaterThan(9);
  expect(lines[0], `[${ctx}] 第 1 行必須是 H1「# … 週記」`).toMatch(/^#\s+.+\s+週記\s*$/);
  expect(lines[1], `[${ctx}] 第 2 行必須為空白（H1 與 header 之間留白）`).toBe('');

  for (const { idx, name, match } of EXPECTED_HEADER_ORDER) {
    expect(match(lines[idx]), `[${ctx}] 第 ${idx + 1} 行應為 ${name}，實際："${lines[idx]}"`).toBe(true);
  }

  expect(lines[7], `[${ctx}] header 區塊後應為空白行`).toBe('');
  expect(lines[8], `[${ctx}] 第 9 行應為分隔線 '---'`).toBe('---');

  // 全檔內「- 週別：」只能出現一次，且必須在 index 2
  const allWeekIdx = lines
    .map((l, i) => (WEEK_LINE_RE.test(l) ? i : -1))
    .filter((i) => i >= 0);
  expect(allWeekIdx, `[${ctx}] 週別行必須恰好出現一次`).toEqual([2]);
}

async function downloadFrom(page: Page, testId: string) {
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId(testId).click(),
  ]);
  const p = await dl.path();
  expect(p, `download for ${testId} must resolve`).toBeTruthy();
  const fs = await import('node:fs/promises');
  return { filename: dl.suggestedFilename(), buf: await fs.readFile(p!) };
}

async function readZipContents(buf: Buffer) {
  const zip = await JSZip.loadAsync(buf);
  const files: Record<string, string> = {};
  for (const name of Object.keys(zip.files)) {
    files[name] = await zip.files[name].async('string');
  }
  return files;
}

async function gotoRange(page: Page, start?: string, end?: string) {
  const q = start && end ? `?start=${start}&end=${end}` : '';
  await page.goto(`${HARNESS_URL}${q}`);
  await expect(page.getByTestId('je-status')).toHaveText('idle');
}

test.describe('Journals export — 週別行位置一致性', () => {
  test('單一老師：週別行位於第 3 行且 header 順序固定', async ({ page }) => {
    await gotoRange(page);
    const { buf } = await downloadFrom(page, 'je-export-single');
    assertWeekLinePosition(buf.toString('utf8'), 'single/master-zhou.md');
  });

  test('multi zip：每個 mentor 檔皆維持一致的週別行位置', async ({ page }) => {
    await gotoRange(page);
    const { buf } = await downloadFrom(page, 'je-export-multi');
    const files = await readZipContents(buf);
    const names = Object.keys(files).sort();
    expect(names).toEqual(['master-zhou.md', 'wendy-us.md']);
    for (const n of names) assertWeekLinePosition(files[n], `multi/${n}`);
  });

  test('multi-mixed zip：導師 + 助教檔皆維持一致的週別行位置', async ({ page }) => {
    await gotoRange(page);
    const { buf } = await downloadFrom(page, 'je-export-multi-mixed');
    const files = await readZipContents(buf);
    const names = Object.keys(files).sort();
    expect(names).toEqual(['assistant-chen.md', 'master-zhou.md']);
    for (const n of names) assertWeekLinePosition(files[n], `mixed/${n}`);
  });

  test('覆寫週別（跨月）：週別行位置不因區間改變而漂移', async ({ page }) => {
    await gotoRange(page, '2026-07-27', '2026-08-02');

    const single = await downloadFrom(page, 'je-export-single');
    assertWeekLinePosition(single.buf.toString('utf8'), 'override/single');

    const multi = await downloadFrom(page, 'je-export-multi');
    const files = await readZipContents(multi.buf);
    for (const [n, md] of Object.entries(files)) {
      assertWeekLinePosition(md, `override/multi/${n}`);
    }
  });
});
