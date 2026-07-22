import { test, expect } from '@playwright/test';
import JSZip from 'jszip';

const HARNESS_URL = '/e2e/journals-export-harness';

const RANGE = { startLabel: '2026-07-13', endLabel: '2026-07-19' };
const MENTOR_A_SLUG = 'master-zhou';
const MENTOR_B_SLUG = 'wendy-us';

const SINGLE_FILENAME = `legendflow-journal-${MENTOR_A_SLUG}-${RANGE.startLabel}_to_${RANGE.endLabel}_published.md`;
const ZIP_FILENAME = `legendflow-journals-${RANGE.startLabel}_to_${RANGE.endLabel}_published.zip`;

test.describe('Journals export — Markdown download', () => {
  test('single mentor exports one .md with correct filename and content', async ({ page }) => {
    await page.goto(HARNESS_URL);
    await expect(page.getByTestId('je-status')).toHaveText('idle');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('je-export-single').click(),
    ]);

    // filename
    expect(download.suggestedFilename()).toBe(SINGLE_FILENAME);

    // content
    const path = await download.path();
    expect(path).toBeTruthy();
    const fs = await import('node:fs/promises');
    const md = await fs.readFile(path!, 'utf8');

    // mentor header + range + slug + row count
    expect(md).toContain('# 老周 週記');
    expect(md).toContain(`- 週別：${RANGE.startLabel} ~ ${RANGE.endLabel}`);
    expect(md).toContain(`- Slug：\`${MENTOR_A_SLUG}\``);
    expect(md).toContain('- 資產類別：台股');
    expect(md).toContain('- 幣別：TWD');
    expect(md).toContain('- 則數：2');

    // both signal sections rendered
    expect(md).toContain('## 1. A-summary-alpha');
    expect(md).toContain('## 2. A-summary-beta');
    expect(md).toContain('標的：2330 台積電');
    expect(md).toContain('標的：2454 聯發科');
    expect(md).toContain('A-detail-alpha');
    expect(md).toContain('> 訊號 ID：`sig-a-1`');
    expect(md).toContain('> 訊號 ID：`sig-a-2`');

    // quantities must match fixture exactly (buy 2 張 / sell 1 張)
    expect(md).toContain('買進數量：2 張');
    expect(md).toContain('賣出數量：1 張');
    expect(md).not.toMatch(/(^|\n)- 數量：/); // action known → verb, never bare fallback
    expect(md).not.toContain('數量：50'); // Wendy's qty must not leak

    // must NOT contain the other mentor's data
    expect(md).not.toContain('Wendy');
    expect(md).not.toContain('AAPL');
    expect(md).not.toContain('sig-b-1');

    await expect(page.getByTestId('je-status'))
      .toHaveText(`single:single:${SINGLE_FILENAME}`);
  });

  test('multiple mentors export a .zip containing one .md per mentor', async ({ page }) => {
    await page.goto(HARNESS_URL);
    await expect(page.getByTestId('je-status')).toHaveText('idle');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('je-export-multi').click(),
    ]);

    expect(download.suggestedFilename()).toBe(ZIP_FILENAME);

    const path = await download.path();
    expect(path).toBeTruthy();
    const fs = await import('node:fs/promises');
    const buf = await fs.readFile(path!);
    const zip = await JSZip.loadAsync(buf);

    const entryNames = Object.keys(zip.files).sort();
    expect(entryNames).toEqual([`${MENTOR_A_SLUG}.md`, `${MENTOR_B_SLUG}.md`].sort());

    const mdA = await zip.files[`${MENTOR_A_SLUG}.md`].async('string');
    expect(mdA).toContain('# 老周 週記');
    expect(mdA).toContain('- 則數：2');
    expect(mdA).toContain('> 訊號 ID：`sig-a-1`');
    expect(mdA).toContain('> 訊號 ID：`sig-a-2`');
    expect(mdA).toContain('買進數量：2 張');
    expect(mdA).toContain('賣出數量：1 張');
    expect(mdA).not.toContain('50 股'); // Wendy's qty must not leak
    // must not leak Wendy content into 老周's file
    expect(mdA).not.toContain('Wendy');
    expect(mdA).not.toContain('sig-b-1');

    const mdB = await zip.files[`${MENTOR_B_SLUG}.md`].async('string');
    expect(mdB).toContain('# Wendy 週記');
    expect(mdB).toContain('- 資產類別：美股');
    expect(mdB).toContain('- 幣別：USD');
    expect(mdB).toContain('- 則數：1');
    expect(mdB).toContain('標的：AAPL');
    expect(mdB).toContain('B-detail-alpha');
    expect(mdB).toContain('> 訊號 ID：`sig-b-1`');
    expect(mdB).toContain('買進數量：50 股');
    expect(mdB).not.toMatch(/\d+\s*張/); // 老周's unit must not leak into quantities
    // must not leak 老周 content into Wendy's file
    expect(mdB).not.toContain('老周');
    expect(mdB).not.toContain('2330');
    expect(mdB).not.toContain('sig-a-1');

    await expect(page.getByTestId('je-status'))
      .toHaveText(`multi:zip:${ZIP_FILENAME}`);
  });
});
