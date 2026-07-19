import { test, expect, type Page } from '@playwright/test';
import JSZip from 'jszip';

/**
 * Regression: 匯出 Markdown → 跑解析器 → 斷言
 *   (a) 週別行實際位置 (lineIndex)
 *   (b) 解析出的 (start, end)
 * 必須與 fixture / URL 覆寫的區間**逐字一致**，且位置固定於 index 2。
 *
 * 窮舉所有 export 型態（都會經過 buildMentorMarkdown）：
 *   - single、multi、multi-mixed
 *   - reversed / interleaved 老師順序
 *   - all / published-only 濾鏡
 *   - dual-unit、missing-fields、no-experts、multi-missing-mixed
 *   - unit=empty/null/whitespace
 * 並涵蓋 3 組週別區間（預設 / 跨月 / 跨年）確保解析器不會漂移。
 */

const HARNESS_URL = '/e2e/journals-export-harness';

const RANGES = [
  { start: '2026-07-13', end: '2026-07-19', label: 'default' },
  { start: '2026-07-27', end: '2026-08-02', label: 'cross-month' },
  { start: '2026-12-28', end: '2027-01-03', label: 'cross-year' },
];

// 涵蓋 harness 內所有會產生 markdown 的按鈕。
const SINGLE_BUTTONS = [
  'je-export-single',
  'je-export-missing-fields',
  'je-export-no-experts',
  'je-export-unit-empty',
  'je-export-unit-null',
  'je-export-unit-whitespace',
];
const ZIP_BUTTONS = [
  'je-export-multi',
  'je-export-multi-mixed',
  'je-export-multi-missing-mixed',
  'je-export-multi-reversed',
  'je-export-multi-interleaved',
  'je-export-dual-unit',
  'je-export-all',
];

/**
 * 純函式解析器：獨立於 src/lib/journalsExport.ts，
 * 目的是「用另一套實作反查」以避免生成端 + 解析端共用同一 bug。
 *
 * 規則：
 *   - 正規化 BOM 與 CRLF/CR
 *   - 掃描每一行，找出符合 `^- 週別[：:] YYYY-MM-DD [~〜～] YYYY-MM-DD$` 的行
 *   - 回傳所有命中的 { lineIndex, start, end, raw }
 */
function parseWeekLines(md: string) {
  const normalized = md.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const re = /^-\s*週別\s*[：:]\s*(\d{4}-\d{2}-\d{2})\s*[~〜～]\s*(\d{4}-\d{2}-\d{2})\s*$/;
  const hits: { lineIndex: number; start: string; end: string; raw: string }[] = [];
  lines.forEach((l, i) => {
    const m = l.match(re);
    if (m) hits.push({ lineIndex: i, start: m[1], end: m[2], raw: l });
  });
  return { lines, hits };
}

async function gotoHarness(page: Page, start?: string, end?: string) {
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

async function readZip(buf: Buffer) {
  const zip = await JSZip.loadAsync(buf);
  const out: Record<string, string> = {};
  for (const n of Object.keys(zip.files)) out[n] = await zip.files[n].async('string');
  return out;
}

/**
 * 對單一 markdown 做「位置 + 解析結果」雙重斷言。
 * 期望：恰好一條週別行，位於 index 2，(start, end) 等於 URL/fixture 區間。
 */
function assertParity(md: string, expectedStart: string, expectedEnd: string, ctx: string) {
  const { lines, hits } = parseWeekLines(md);
  expect(hits.length, `[${ctx}] 週別行必須恰好命中一次`).toBe(1);
  const h = hits[0];
  expect(h.lineIndex, `[${ctx}] 週別行必須位於 index 2`).toBe(2);
  expect(h.start, `[${ctx}] 解析 start 必須等於 ${expectedStart}`).toBe(expectedStart);
  expect(h.end, `[${ctx}] 解析 end 必須等於 ${expectedEnd}`).toBe(expectedEnd);

  // 交叉驗證：解析器命中的行必須就是 lines[2] 本體
  expect(h.raw, `[${ctx}] raw 必須就是 lines[lineIndex]`).toBe(lines[h.lineIndex]);

  // 反向健檢：全檔不得再出現另一條疑似週別行（避免 header 污染或跨 mentor 摻雜）
  const looseRe = /週別\s*[：:]/;
  const looseHits = lines.filter((l) => looseRe.test(l));
  expect(looseHits.length, `[${ctx}] 全檔僅能有一行帶「週別：」字樣`).toBe(1);
}

for (const range of RANGES) {
  test.describe(`Journals export — week-line parser parity [${range.label}]`, () => {
    for (const btn of SINGLE_BUTTONS) {
      test(`single/${btn} 位置與解析區間一致`, async ({ page }) => {
        await gotoHarness(page, range.start, range.end);
        const { filename, buf } = await downloadFrom(page, btn);
        expect(filename.endsWith('.md'), `[${btn}] 單檔應為 .md：${filename}`).toBe(true);
        assertParity(buf.toString('utf8'), range.start, range.end, `${range.label}/${btn}/${filename}`);
      });
    }

    for (const btn of ZIP_BUTTONS) {
      test(`zip/${btn} 內每份 mentor markdown 位置與解析區間一致且跨檔對齊`, async ({ page }) => {
        await gotoHarness(page, range.start, range.end);
        const { filename, buf } = await downloadFrom(page, btn);
        expect(filename.endsWith('.zip'), `[${btn}] 應為 zip：${filename}`).toBe(true);
        const files = await readZip(buf);
        const names = Object.keys(files);
        expect(names.length, `[${btn}] zip 至少應含 2 份 mentor 檔`).toBeGreaterThanOrEqual(2);

        const parsedTuples: string[] = [];
        for (const n of names) {
          assertParity(files[n], range.start, range.end, `${range.label}/${btn}/${n}`);
          const h = parseWeekLines(files[n]).hits[0];
          parsedTuples.push(`${h.lineIndex}|${h.start}|${h.end}`);
        }
        // 跨檔一致性：(lineIndex, start, end) 三元組去重後只剩一種
        expect(new Set(parsedTuples).size, `[${btn}] 跨 mentor 檔 (index,start,end) 必須全部相同`).toBe(1);
      });
    }
  });
}
