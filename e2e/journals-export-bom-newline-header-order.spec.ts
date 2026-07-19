import { test, expect, type Page } from '@playwright/test';
import JSZip from 'jszip';

/**
 * Regression: 在 UTF-8 有無 BOM × 三種換行 (LF / CRLF / CR-only)
 * 共 6 種組合下，每個 mentor Markdown 的：
 *   1) header 順序：H1 → 空 → 週別 → Slug → 資產類別 → 幣別 → 則數 → 空 → ---
 *   2) 「- 週別：...」行位置（normalize 後 index = 2）
 * 都必須完全不改變。
 *
 * 覆蓋匯出：單一老師 / multi zip / multi-mixed zip / 覆寫週別（跨月）。
 */

const HARNESS_URL = '/e2e/journals-export-harness';

const WEEK_LINE_RE     = /^-\s*週別[：:]\s*(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})\s*$/;
const SLUG_LINE_RE     = /^-\s*Slug[：:]\s*`.+`\s*$/;
const ASSET_LINE_RE    = /^-\s*資產類別[：:]/;
const CURRENCY_LINE_RE = /^-\s*幣別[：:]/;
const COUNT_LINE_RE    = /^-\s*則數[：:]\s*\d+\s*$/;
const H1_RE            = /^#\s+.+\s+週記\s*$/;

const HEADER_SEQUENCE: Array<{ idx: number; name: string; match: (l: string) => boolean }> = [
  { idx: 0, name: 'H1',        match: (l) => H1_RE.test(l) },
  { idx: 1, name: 'blank',     match: (l) => l === '' },
  { idx: 2, name: 'week',      match: (l) => WEEK_LINE_RE.test(l) },
  { idx: 3, name: 'slug',      match: (l) => SLUG_LINE_RE.test(l) },
  { idx: 4, name: 'asset',     match: (l) => ASSET_LINE_RE.test(l) },
  { idx: 5, name: 'currency',  match: (l) => CURRENCY_LINE_RE.test(l) },
  { idx: 6, name: 'count',     match: (l) => COUNT_LINE_RE.test(l) },
  { idx: 7, name: 'blank',     match: (l) => l === '' },
  { idx: 8, name: 'hr',        match: (l) => l === '---' },
];

type Variant = { bom: boolean; nl: 'LF' | 'CRLF' | 'CR'; label: string };
const VARIANTS: Variant[] = [
  { bom: false, nl: 'LF',   label: 'no-BOM + LF' },
  { bom: false, nl: 'CRLF', label: 'no-BOM + CRLF' },
  { bom: false, nl: 'CR',   label: 'no-BOM + CR' },
  { bom: true,  nl: 'LF',   label: 'BOM + LF' },
  { bom: true,  nl: 'CRLF', label: 'BOM + CRLF' },
  { bom: true,  nl: 'CR',   label: 'BOM + CR' },
];

function applyVariant(md: string, v: Variant): string {
  // 先歸零成 LF，再依變體套 BOM 與換行
  const base = md.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const withNl =
    v.nl === 'LF'   ? base :
    v.nl === 'CRLF' ? base.replace(/\n/g, '\r\n') :
                      base.replace(/\n/g, '\r');
  return (v.bom ? '\uFEFF' : '') + withNl;
}

function normalizeLines(md: string): string[] {
  return md.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

function assertHeaderOrderAndWeekIdx(md: string, ctx: string, expected: { start: string; end: string }) {
  const lines = normalizeLines(md);
  expect(lines.length, `[${ctx}] 檔案內容不可短於 header 區塊`).toBeGreaterThan(9);

  for (const step of HEADER_SEQUENCE) {
    expect(
      step.match(lines[step.idx]),
      `[${ctx}] 第 ${step.idx + 1} 行應為 ${step.name}，實際："${lines[step.idx]}"`,
    ).toBe(true);
  }

  // 週別行僅出現一次且位於 index 2
  const weekIdxs = lines
    .map((l, i) => (WEEK_LINE_RE.test(l) ? i : -1))
    .filter((i) => i >= 0);
  expect(weekIdxs, `[${ctx}] 週別行必須恰好出現一次於 index 2`).toEqual([2]);

  // 解析結果需符合預期
  const m = lines[2].match(WEEK_LINE_RE)!;
  expect({ start: m[1], end: m[2] }, `[${ctx}] 週別解析結果`).toEqual(expected);
}

function runAllVariants(originalMd: string, ctx: string, expected: { start: string; end: string }) {
  for (const v of VARIANTS) {
    const mutated = applyVariant(originalMd, v);
    // 保護：確認變體確實變換過
    if (v.bom) expect(mutated.startsWith('\uFEFF'), `[${ctx}/${v.label}] 需含 BOM`).toBe(true);
    if (v.nl === 'CRLF') expect(mutated.includes('\r\n'), `[${ctx}/${v.label}] 需含 \\r\\n`).toBe(true);
    if (v.nl === 'CR')   expect(/\r(?!\n)/.test(mutated), `[${ctx}/${v.label}] 需含裸 \\r`).toBe(true);
    assertHeaderOrderAndWeekIdx(mutated, `${ctx}/${v.label}`, expected);
  }
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

test.describe('Journals export — BOM × 換行 6 變體下 header 順序與週別行位置不變', () => {
  test('單一老師：6 變體皆維持 header 順序與 index 2', async ({ page }) => {
    await gotoRange(page);
    const { buf } = await downloadFrom(page, 'je-export-single');
    runAllVariants(buf.toString('utf8'), 'single/master-zhou.md', {
      start: '2026-07-13', end: '2026-07-19',
    });
  });

  test('multi zip：兩位老師檔在 6 變體下皆維持 header 順序與 index 2', async ({ page }) => {
    await gotoRange(page);
    const { buf } = await downloadFrom(page, 'je-export-multi');
    const files = await readZipContents(buf);
    const names = Object.keys(files).sort();
    expect(names).toEqual(['master-zhou.md', 'wendy-us.md']);
    for (const n of names) {
      runAllVariants(files[n], `multi/${n}`, { start: '2026-07-13', end: '2026-07-19' });
    }
  });

  test('multi-mixed zip：導師 + 助教在 6 變體下皆維持 header 順序與 index 2', async ({ page }) => {
    await gotoRange(page);
    const { buf } = await downloadFrom(page, 'je-export-multi-mixed');
    const files = await readZipContents(buf);
    const names = Object.keys(files).sort();
    expect(names).toEqual(['assistant-chen.md', 'master-zhou.md']);
    for (const n of names) {
      runAllVariants(files[n], `mixed/${n}`, { start: '2026-07-13', end: '2026-07-19' });
    }
  });

  test('覆寫週別（跨月）：6 變體下 header 順序、index 2 與新區間解析一致', async ({ page }) => {
    const start = '2026-07-27';
    const end = '2026-08-02';
    await gotoRange(page, start, end);

    const single = await downloadFrom(page, 'je-export-single');
    runAllVariants(single.buf.toString('utf8'), 'override/single', { start, end });

    const multi = await downloadFrom(page, 'je-export-multi');
    const files = await readZipContents(multi.buf);
    for (const [n, md] of Object.entries(files)) {
      runAllVariants(md, `override/multi/${n}`, { start, end });
    }
  });
});
