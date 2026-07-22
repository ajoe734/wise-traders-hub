/**
 * Regression: quantity_unit empty / missing / null / whitespace
 * must fall back to the default unit "股" in exported Markdown.
 *
 * Covers:
 *   - single mentor whose rows have empty string, undefined, null, and whitespace unit
 *   - multi-mentor export where another mentor uses "張" → no unit leakage
 *   - exact numbers from fixtures match the rendered "買進數量 / 賣出數量" lines
 */
import { test, expect } from '@playwright/test';
import JSZip from 'jszip';

const HARNESS_URL = '/e2e/journals-export-harness';
const RANGE = { startLabel: '2026-07-13', endLabel: '2026-07-19' };
const MENTOR_C_SLUG = 'assistant-chen';
const MENTOR_A_SLUG = 'master-zhou';

const EMPTY_UNIT_FILENAME = `legendflow-journal-${MENTOR_C_SLUG}-${RANGE.startLabel}_to_${RANGE.endLabel}_published.md`;
const MIXED_ZIP_FILENAME = `legendflow-journals-${RANGE.startLabel}_to_${RANGE.endLabel}_published.zip`;

async function readMdFromDownload(download: import('@playwright/test').Download) {
  const fs = await import('node:fs/promises');
  const path = await download.path();
  expect(path).toBeTruthy();
  return fs.readFile(path!, 'utf8');
}

test.describe('Journals export — quantity_unit default fallback', () => {
  test('single mentor: empty / undefined / null / whitespace unit all fall back to "股"', async ({ page }) => {
    await page.goto(HARNESS_URL);
    await expect(page.getByTestId('je-status')).toHaveText('idle');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('je-export-empty-unit').click(),
    ]);

    expect(download.suggestedFilename()).toBe(EMPTY_UNIT_FILENAME);

    const md = await readMdFromDownload(download);

    // mentor header + row count
    expect(md).toContain('# 助教小陳 週記');
    expect(md).toContain('- 則數：4');
    expect(md).toContain(`- Slug：\`${MENTOR_C_SLUG}\``);

    // every quantity line must render with the tw_stock default unit "張"
    expect(md).toContain('買進數量：3 張');
    expect(md).toContain('賣出數量：5 張');
    expect(md).toContain('買進數量：7 張');
    expect(md).toContain('賣出數量：9 張');

    // must not fall back to "股" (tw_stock default = 張) or leave the line bare
    expect(md).not.toContain('買進數量：3 股');
    expect(md).not.toContain('賣出數量：5 股');
    expect(md).not.toMatch(/買進數量：3\s*$/m);
    expect(md).not.toMatch(/賣出數量：5\s*$/m);

    // the generic "數量" verb must not appear because action is known
    expect(md).not.toMatch(/(^|\n)- 數量：/);

    await expect(page.getByTestId('je-status'))
      .toHaveText(`empty-unit:single:${EMPTY_UNIT_FILENAME}`);
  });

  test('multi-mentor mixed units: default "股" stays inside assistant-chen.md, "張" stays inside master-zhou.md', async ({ page }) => {
    await page.goto(HARNESS_URL);
    await expect(page.getByTestId('je-status')).toHaveText('idle');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('je-export-multi-mixed').click(),
    ]);

    expect(download.suggestedFilename()).toBe(MIXED_ZIP_FILENAME);

    const fs = await import('node:fs/promises');
    const path = await download.path();
    expect(path).toBeTruthy();
    const buf = await fs.readFile(path!);
    const zip = await JSZip.loadAsync(buf);

    const entryNames = Object.keys(zip.files).sort();
    expect(entryNames).toEqual([`${MENTOR_A_SLUG}.md`, `${MENTOR_C_SLUG}.md`].sort());

    const mdA = await zip.files[`${MENTOR_A_SLUG}.md`].async('string');
    expect(mdA).toContain('# 老周 週記');
    expect(mdA).toContain('買進數量：2 張');
    expect(mdA).toContain('賣出數量：1 張');
    // tw_stock default is 張 for both mentors; ensure no cross-file bleed of assistant-chen's content
    expect(mdA).not.toContain('助教小陳');
    expect(mdA).not.toContain('0050');

    const mdC = await zip.files[`${MENTOR_C_SLUG}.md`].async('string');
    expect(mdC).toContain('# 助教小陳 週記');
    expect(mdC).toContain('- 則數：4');
    expect(mdC).toContain('買進數量：3 張');
    expect(mdC).toContain('賣出數量：5 張');
    expect(mdC).toContain('買進數量：7 張');
    expect(mdC).toContain('賣出數量：9 張');
    // must not fall back to "股"
    expect(mdC).not.toContain('買進數量：3 股');
    expect(mdC).not.toContain('賣出數量：5 股');
    expect(mdC).not.toContain('老周');
    expect(mdC).not.toContain('2330');

    await expect(page.getByTestId('je-status'))
      .toHaveText(`multi-mixed:zip:${MIXED_ZIP_FILENAME}`);
  });
});
