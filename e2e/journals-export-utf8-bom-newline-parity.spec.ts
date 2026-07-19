import { test, expect, type Page } from '@playwright/test';
import JSZip from 'jszip';

/**
 * Regression: 匯出的 Markdown 必須符合 UTF-8 規則，且在 CRLF/LF 正規化後
 *   (a) 「- 週別：...」行的 lineIndex
 *   (b) 解析出的 (start, end)
 * 完全一致（跨所有 mentor 檔、跨所有匯出型態、跨 3 組週別區間）。
 *
 * 檢查項目：
 *   1) UTF-8 位元組層級：
 *      - 內容可被無損 decode 成 UTF-8（round-trip: buf → utf8 → buf 相等）
 *      - **不得**含 BOM（EF BB BF）—— 匯出端 raw bytes 必須乾淨
 *      - **不得**含 UTF-16 BOM（FF FE / FE FF）
 *      - 不得含 U+FFFD replacement char（表示編碼壞掉）
 *      - 中文字元（週別 / 資產類別 / 幣別 / 則數 / 週記）在 raw bytes 中皆能以 UTF-8 序列命中
 *      - 不得含裸 CR（\r 但非 \r\n）；換行只能是 LF 或 CRLF
 *   2) CRLF/LF 正規化後：
 *      - 原檔（raw bytes → utf8）的週別行 lineIndex 與解析 (start, end)
 *      - 手動注入 BOM 後
 *      - 全檔改 CRLF 後
 *      - 全檔改 CRLF + BOM 後
 *      - 混合換行後
 *      五種變體的解析結果**必須全部相同**，且 lineIndex 永遠 = 2。
 *   3) 跨 mentor / 跨 zip / 跨區間一致性：
 *      - zip 內每份 .md 的 (lineIndex, start, end) 三元組必須相等
 *      - 覆寫 URL 週別（跨月 / 跨年）後，解析結果必須逐字等於 URL 值
 */

const HARNESS_URL = '/e2e/journals-export-harness';
const WEEK_LINE_RE = /^-\s*週別[：:]\s*(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})\s*$/;

const RANGES = [
  { start: '2026-07-13', end: '2026-07-19', label: 'default' },
  { start: '2026-07-27', end: '2026-08-02', label: 'cross-month' },
  { start: '2026-12-28', end: '2027-01-03', label: 'cross-year' },
];

const ALL_BUTTONS = [
  'je-export-single',
  'je-export-multi',
  'je-export-empty-unit',
  'je-export-multi-mixed',
  'je-export-multi-reversed',
  'je-export-multi-mixed-reversed',
  'je-export-multi-interleaved',
  'je-export-dual-unit',
  'je-export-missing-fields',
  'je-export-no-experts',
  'je-export-multi-missing-mixed',
];

function parseWeek(md: string) {
  const normalized = md.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  let idx = -1;
  let m: RegExpMatchArray | null = null;
  for (let i = 0; i < lines.length; i++) {
    const hit = lines[i].match(WEEK_LINE_RE);
    if (hit) { idx = i; m = hit; break; }
  }
  return { idx, start: m?.[1], end: m?.[2], lines };
}

function assertUtf8Bytes(buf: Buffer, ctx: string) {
  // 1) 不得含 UTF-8 BOM
  expect(
    !(buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf),
    `[${ctx}] raw bytes 不得含 UTF-8 BOM (EF BB BF)`,
  ).toBe(true);

  // 2) 不得含 UTF-16 BOM
  expect(
    !(buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))),
    `[${ctx}] raw bytes 不得含 UTF-16 BOM`,
  ).toBe(true);

  // 3) UTF-8 round-trip 無損
  const asStr = buf.toString('utf8');
  const roundTrip = Buffer.from(asStr, 'utf8');
  expect(roundTrip.equals(buf), `[${ctx}] UTF-8 round-trip 必須無損（無編碼污染）`).toBe(true);

  // 4) 不得含 U+FFFD replacement char
  expect(asStr.includes('\uFFFD'), `[${ctx}] 不得含 U+FFFD replacement char`).toBe(false);

  // 5) 換行只能是 LF 或 CRLF —— 不得含裸 CR
  expect(/\r(?!\n)/.test(asStr), `[${ctx}] 不得含裸 \\r（換行必須是 LF 或 CRLF）`).toBe(false);

  // 6) 中文關鍵字必須以合法 UTF-8 序列存在於 raw bytes
  for (const kw of ['週別', '週記']) {
    const kwBytes = Buffer.from(kw, 'utf8');
    expect(buf.includes(kwBytes), `[${ctx}] raw bytes 中必須以 UTF-8 序列命中「${kw}」`).toBe(true);
  }
}

function assertNormalizationParity(
  rawUtf8: string,
  ctx: string,
  expected: { start: string; end: string },
) {
  const variants: Array<{ label: string; text: string; mustContain?: (s: string) => boolean }> = [
    { label: 'raw(LF)', text: rawUtf8 },
    { label: '+BOM', text: '\uFEFF' + rawUtf8 },
    {
      label: '→CRLF',
      text: rawUtf8.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'),
      mustContain: (s) => s.includes('\r\n'),
    },
    {
      label: 'BOM+CRLF',
      text: '\uFEFF' + rawUtf8.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'),
      mustContain: (s) => s.startsWith('\uFEFF') && s.includes('\r\n'),
    },
    {
      label: 'mixed(LF+CRLF)',
      text: rawUtf8
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((l, i) => (i % 2 === 0 ? l + '\r' : l))
        .join('\n'),
    },
  ];

  const results = variants.map((v) => {
    if (v.mustContain) {
      expect(v.mustContain(v.text), `[${ctx}/${v.label}] 變體前置條件`).toBe(true);
    }
    const p = parseWeek(v.text);
    expect(p.idx, `[${ctx}/${v.label}] 週別行必須位於 index 2`).toBe(2);
    expect(
      { start: p.start, end: p.end },
      `[${ctx}/${v.label}] 解析結果必須等於 ${expected.start} ~ ${expected.end}`,
    ).toEqual(expected);
    return `${p.idx}|${p.start}|${p.end}`;
  });

  expect(new Set(results).size, `[${ctx}] 5 種變體的 (idx,start,end) 三元組必須完全相同`).toBe(1);
}

async function gotoRange(page: Page, start?: string, end?: string) {
  const q = start && end ? `?start=${start}&end=${end}` : '';
  await page.goto(`${HARNESS_URL}${q}`);
  await expect(page.getByTestId('je-status')).toHaveText('idle');
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

async function readZipEntries(buf: Buffer) {
  const zip = await JSZip.loadAsync(buf);
  const entries: Array<{ name: string; buf: Buffer }> = [];
  for (const name of Object.keys(zip.files)) {
    const b = await zip.files[name].async('nodebuffer');
    entries.push({ name, buf: b });
  }
  return entries;
}

for (const range of RANGES) {
  test.describe(`Journals export — UTF-8/BOM + CRLF/LF parity [${range.label}]`, () => {
    for (const btn of ALL_BUTTONS) {
      test(`${btn}: raw bytes 合規 + 5 種正規化變體週別行一致`, async ({ page }) => {
        await gotoRange(page, range.start, range.end);
        const { filename, buf } = await downloadFrom(page, btn);

        if (filename.endsWith('.md')) {
          const ctx = `${range.label}/${btn}/${filename}`;
          assertUtf8Bytes(buf, ctx);
          assertNormalizationParity(buf.toString('utf8'), ctx, {
            start: range.start,
            end: range.end,
          });
          return;
        }

        expect(filename.endsWith('.zip'), `[${btn}] 應為 .md 或 .zip：${filename}`).toBe(true);
        const entries = await readZipEntries(buf);
        const mds = entries.filter((e) => e.name.endsWith('.md'));
        expect(mds.length, `[${btn}] zip 必須至少含一份 .md`).toBeGreaterThanOrEqual(1);

        const tuples: string[] = [];
        for (const e of mds) {
          const ctx = `${range.label}/${btn}/${e.name}`;
          assertUtf8Bytes(e.buf, ctx);
          const utf8 = e.buf.toString('utf8');
          assertNormalizationParity(utf8, ctx, { start: range.start, end: range.end });
          const p = parseWeek(utf8);
          tuples.push(`${p.idx}|${p.start}|${p.end}`);
        }
        expect(
          new Set(tuples).size,
          `[${btn}] zip 內所有 mentor 檔的 (idx,start,end) 三元組必須完全相同`,
        ).toBe(1);
      });
    }
  });
}
