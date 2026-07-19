import { test, expect, type Page } from '@playwright/test';
import JSZip from 'jszip';

/**
 * Regression: 當 multi / multi-mixed 匯出時輸入的老師列順序改變
 * （反轉、交錯），每個 mentor Markdown 內：
 *   1) 「- 週別：」行必定位於 index 2
 *   2) header 區塊 (line 0–8) 只能屬於「該檔本人的」欄位
 *      —— 不得洩漏其他老師的 name / slug / 資產類別 / 幣別
 *   3) 週別解析結果與 fixture 一致
 *
 * 覆蓋按鈕：
 *   - je-export-multi                   （老周 → Wendy 正序）
 *   - je-export-multi-reversed          （Wendy → 老周 反序）
 *   - je-export-multi-mixed             （老周 → 助教 正序）
 *   - je-export-multi-mixed-reversed    （助教 → 老周 反序）
 *   - je-export-multi-interleaved       （A1,C1,A2,C2,... 交錯）
 */

const HARNESS_URL = '/e2e/journals-export-harness';
const WEEK_LINE_RE = /^-\s*週別[：:]\s*(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})\s*$/;

type MentorProfile = { name: string; slug: string; asset: string; currency: string };

const PROFILES: Record<string, MentorProfile> = {
  'master-zhou.md':    { name: '老周',       slug: 'master-zhou',       asset: '台股', currency: 'TWD' },
  'wendy-us.md':       { name: 'Wendy',      slug: 'wendy-us',          asset: '美股', currency: 'USD' },
  'assistant-chen.md': { name: '助教小陳',   slug: 'assistant-chen',    asset: '台股', currency: 'TWD' },
};

async function downloadFrom(page: Page, testId: string) {
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId(testId).click(),
  ]);
  const p = await dl.path();
  expect(p, `download for ${testId}`).toBeTruthy();
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

function assertPerFile(
  filename: string,
  md: string,
  ctx: string,
  expectedRange: { start: string; end: string },
) {
  const self = PROFILES[filename];
  expect(self, `[${ctx}] 未知的檔案 ${filename}`).toBeTruthy();

  const lines = md.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
  expect(lines.length, `[${ctx}/${filename}] 至少含 header 區塊`).toBeGreaterThan(9);

  // 1) 週別行必定 index 2
  const weekIdxs = lines.map((l, i) => (WEEK_LINE_RE.test(l) ? i : -1)).filter((i) => i >= 0);
  expect(weekIdxs, `[${ctx}/${filename}] 週別行必須恰好出現一次於 index 2`).toEqual([2]);
  const m = lines[2].match(WEEK_LINE_RE)!;
  expect({ start: m[1], end: m[2] }, `[${ctx}/${filename}] 週別解析`).toEqual(expectedRange);

  // 2) H1 名字必須是自己
  expect(lines[0], `[${ctx}/${filename}] H1 必須是本人`).toBe(`# ${self.name} 週記`);
  // 3) header 區塊（前 9 行）必須是自己的 slug / 資產類別 / 幣別
  const headerBlock = lines.slice(0, 9).join('\n');
  expect(headerBlock, `[${ctx}/${filename}] Slug 必須是本人`).toContain(`- Slug：\`${self.slug}\``);
  expect(headerBlock, `[${ctx}/${filename}] 資產類別必須是本人`).toContain(`- 資產類別：${self.asset}`);
  expect(headerBlock, `[${ctx}/${filename}] 幣別必須是本人`).toContain(`- 幣別：${self.currency}`);

  // 4) header 區塊不得洩漏「其他老師」的 name / slug / 幣別
  for (const [otherFile, other] of Object.entries(PROFILES)) {
    if (otherFile === filename) continue;
    expect(headerBlock, `[${ctx}/${filename}] header 不得洩漏 ${other.name}`).not.toContain(other.name);
    expect(headerBlock, `[${ctx}/${filename}] header 不得洩漏 slug ${other.slug}`).not.toContain(other.slug);
    // 幣別可能相同（TWD/TWD），只有當幣別不同時才斷言
    if (other.currency !== self.currency) {
      expect(headerBlock, `[${ctx}/${filename}] header 不得洩漏 ${other.currency}`).not.toContain(
        `- 幣別：${other.currency}`,
      );
    }
  }
}

function assertZip(
  files: Record<string, string>,
  expectedNames: string[],
  ctx: string,
  range: { start: string; end: string },
) {
  const names = Object.keys(files).sort();
  expect(names, `[${ctx}] zip 內檔名`).toEqual(expectedNames);
  for (const n of names) assertPerFile(n, files[n], ctx, range);

  // 每份檔的 week line 必須字面完全一致（不能漂移）
  const weekLines = names.map((n) =>
    files[n].replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n')[2],
  );
  expect(new Set(weekLines).size, `[${ctx}] 所有 mentor 週別行必須字面相同`).toBe(1);
}

async function gotoRange(page: Page, start?: string, end?: string) {
  const q = start && end ? `?start=${start}&end=${end}` : '';
  await page.goto(`${HARNESS_URL}${q}`);
  await expect(page.getByTestId('je-status')).toHaveText('idle');
}

const DEFAULT_RANGE = { start: '2026-07-13', end: '2026-07-19' };

test.describe('Journals export — 老師順序改變下週別行位置與 header 隔離', () => {
  test('multi 正序 vs 反序：兩份 zip 內檔名相同、每檔 header 皆屬本人', async ({ page }) => {
    await gotoRange(page);

    const forward = await downloadFrom(page, 'je-export-multi');
    const reversed = await downloadFrom(page, 'je-export-multi-reversed');

    const forwardFiles = await readZipContents(forward.buf);
    const reversedFiles = await readZipContents(reversed.buf);

    assertZip(forwardFiles, ['master-zhou.md', 'wendy-us.md'], 'multi/forward', DEFAULT_RANGE);
    assertZip(reversedFiles, ['master-zhou.md', 'wendy-us.md'], 'multi/reversed', DEFAULT_RANGE);

    // 兩種順序下相同檔的 header 區塊必須字面完全一致
    for (const name of ['master-zhou.md', 'wendy-us.md']) {
      const a = forwardFiles[name].replace(/\r\n/g, '\n').split('\n').slice(0, 9).join('\n');
      const b = reversedFiles[name].replace(/\r\n/g, '\n').split('\n').slice(0, 9).join('\n');
      expect(a, `[${name}] 順序改變後 header 不得變動`).toBe(b);
    }
  });

  test('multi-mixed 正序 vs 反序：header 隔離、週別行仍在 index 2', async ({ page }) => {
    await gotoRange(page);

    const forward = await downloadFrom(page, 'je-export-multi-mixed');
    const reversed = await downloadFrom(page, 'je-export-multi-mixed-reversed');

    const forwardFiles = await readZipContents(forward.buf);
    const reversedFiles = await readZipContents(reversed.buf);

    assertZip(forwardFiles, ['assistant-chen.md', 'master-zhou.md'], 'mixed/forward', DEFAULT_RANGE);
    assertZip(reversedFiles, ['assistant-chen.md', 'master-zhou.md'], 'mixed/reversed', DEFAULT_RANGE);

    for (const name of ['assistant-chen.md', 'master-zhou.md']) {
      const a = forwardFiles[name].replace(/\r\n/g, '\n').split('\n').slice(0, 9).join('\n');
      const b = reversedFiles[name].replace(/\r\n/g, '\n').split('\n').slice(0, 9).join('\n');
      expect(a, `[${name}] 順序改變後 header 不得變動`).toBe(b);
    }
  });

  test('multi-mixed 交錯輸入：分檔仍正確、header 不得混入其他老師', async ({ page }) => {
    await gotoRange(page);
    const { buf } = await downloadFrom(page, 'je-export-multi-interleaved');
    const files = await readZipContents(buf);
    assertZip(files, ['assistant-chen.md', 'master-zhou.md'], 'interleaved', DEFAULT_RANGE);
  });

  test('覆寫週別（跨月）× 反序：header 隔離與 index 2 依舊成立', async ({ page }) => {
    const start = '2026-07-27';
    const end = '2026-08-02';
    await gotoRange(page, start, end);

    const reversed = await downloadFrom(page, 'je-export-multi-reversed');
    const files = await readZipContents(reversed.buf);
    assertZip(files, ['master-zhou.md', 'wendy-us.md'], 'override/reversed', { start, end });

    const mixedReversed = await downloadFrom(page, 'je-export-multi-mixed-reversed');
    const files2 = await readZipContents(mixedReversed.buf);
    assertZip(files2, ['assistant-chen.md', 'master-zhou.md'], 'override/mixed-reversed', { start, end });
  });
});
