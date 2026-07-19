import { test, expect, type Page } from '@playwright/test';
import JSZip from 'jszip';

/**
 * Regression: 「- 週別：...」行位置（index 2）與解析結果
 * 必須在 LF (\n) 與 Windows CRLF (\r\n) 兩種換行下完全一致。
 *
 * 覆蓋：
 *   - 單一老師 .md
 *   - multi zip（老周 + Wendy 美股）
 *   - multi-mixed zip（老周 + 助教小陳）
 *   - 覆寫週別（跨月）情境
 *   - 額外：CRLF + BOM 混合，仍需維持 index 2 與同樣的 (start, end) 解析結果
 */

const HARNESS_URL = '/e2e/journals-export-harness';
const WEEK_LINE_RE = /^-\s*週別[：:]\s*(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})\s*$/;

function parseWeek(md: string): { idx: number; start: string; end: string } {
  const normalized = md.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  let idx = -1;
  let m: RegExpMatchArray | null = null;
  for (let i = 0; i < lines.length; i++) {
    const hit = lines[i].match(WEEK_LINE_RE);
    if (hit) { idx = i; m = hit; break; }
  }
  expect(m, '必須找到週別行').toBeTruthy();
  return { idx, start: m![1], end: m![2] };
}

function assertNewlineParity(originalLF: string, ctx: string, expected: { start: string; end: string }) {
  // 1) 原檔 (LF) —— 位置 = 2 且解析正確
  const lf = parseWeek(originalLF);
  expect(lf.idx, `[${ctx}] LF 週別行必須位於 index 2`).toBe(2);
  expect({ start: lf.start, end: lf.end }, `[${ctx}] LF 解析結果`).toEqual(expected);

  // 2) 轉成 CRLF —— 位置與解析必須一致
  const crlf = originalLF.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
  expect(crlf.includes('\r\n'), `[${ctx}] CRLF 版本必須含 \\r\\n`).toBe(true);
  const parsedCrlf = parseWeek(crlf);
  expect(parsedCrlf.idx, `[${ctx}] CRLF 週別行位置必須 = LF 位置 (index 2)`).toBe(2);
  expect(
    { start: parsedCrlf.start, end: parsedCrlf.end },
    `[${ctx}] CRLF 解析結果必須與 LF 完全一致`,
  ).toEqual(expected);

  // 3) CRLF + BOM 混合 —— 位置與解析仍需一致
  const crlfBom = '\uFEFF' + crlf;
  const parsedBom = parseWeek(crlfBom);
  expect(parsedBom.idx, `[${ctx}] CRLF+BOM 週別行位置必須 = index 2`).toBe(2);
  expect(
    { start: parsedBom.start, end: parsedBom.end },
    `[${ctx}] CRLF+BOM 解析結果必須與 LF 完全一致`,
  ).toEqual(expected);

  // 4) 混合換行（部分 LF + 部分 CRLF）—— 位置與解析仍需一致
  const mixed = originalLF
    .split('\n')
    .map((l, i) => (i % 2 === 0 ? l + '\r' : l))
    .join('\n');
  const parsedMixed = parseWeek(mixed);
  expect(parsedMixed.idx, `[${ctx}] 混合換行週別行位置必須 = index 2`).toBe(2);
  expect(
    { start: parsedMixed.start, end: parsedMixed.end },
    `[${ctx}] 混合換行解析結果必須與 LF 完全一致`,
  ).toEqual(expected);
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

test.describe('Journals export — 週別行位置 × CRLF/LF 換行一致性', () => {
  test('單一老師：LF / CRLF / CRLF+BOM / 混合換行皆維持 index 2 且解析一致', async ({ page }) => {
    await gotoRange(page);
    const { buf } = await downloadFrom(page, 'je-export-single');
    assertNewlineParity(buf.toString('utf8'), 'single/master-zhou.md', {
      start: '2026-07-13',
      end: '2026-07-19',
    });
  });

  test('multi zip：兩位老師檔在 CRLF/LF 下皆維持 index 2 且解析一致', async ({ page }) => {
    await gotoRange(page);
    const { buf } = await downloadFrom(page, 'je-export-multi');
    const files = await readZipContents(buf);
    const names = Object.keys(files).sort();
    expect(names).toEqual(['master-zhou.md', 'wendy-us.md']);
    for (const n of names) {
      assertNewlineParity(files[n], `multi/${n}`, { start: '2026-07-13', end: '2026-07-19' });
    }
  });

  test('multi-mixed zip：導師 + 助教檔在 CRLF/LF 下皆維持 index 2 且解析一致', async ({ page }) => {
    await gotoRange(page);
    const { buf } = await downloadFrom(page, 'je-export-multi-mixed');
    const files = await readZipContents(buf);
    const names = Object.keys(files).sort();
    expect(names).toEqual(['assistant-chen.md', 'master-zhou.md']);
    for (const n of names) {
      assertNewlineParity(files[n], `mixed/${n}`, { start: '2026-07-13', end: '2026-07-19' });
    }
  });

  test('覆寫週別（跨月）：CRLF/LF 下 index 2 與解析結果與新區間一致', async ({ page }) => {
    const start = '2026-07-27';
    const end = '2026-08-02';
    await gotoRange(page, start, end);

    const single = await downloadFrom(page, 'je-export-single');
    assertNewlineParity(single.buf.toString('utf8'), 'override/single', { start, end });

    const multi = await downloadFrom(page, 'je-export-multi');
    const files = await readZipContents(multi.buf);
    for (const [n, md] of Object.entries(files)) {
      assertNewlineParity(md, `override/multi/${n}`, { start, end });
    }
  });
});
