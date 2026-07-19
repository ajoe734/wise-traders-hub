import { test, expect, type Page } from '@playwright/test';
import JSZip from 'jszip';

/**
 * Regression: 當老師資料出現缺失（slug / asset_class / currency 為 null，
 * 甚至整個 experts 物件為 null）時，匯出的 Markdown 仍必須：
 *
 *   1) 不會拋錯、不會產生空檔或缺欄；
 *   2) 「- 週別：YYYY-MM-DD ~ YYYY-MM-DD」永遠位於 index 2（第 3 行）；
 *   3) header 順序固定為 H1 → 空白 → 週別 → Slug → 資產類別 → 幣別 → 則數 → 空白 → `---`；
 *   4) 缺失的欄位以安全 fallback 呈現：
 *        - slug 缺失 → 使用 expert_id 作為 slug（含檔名）
 *        - asset / currency 缺失 → 顯示為 "-"
 *        - experts 物件為 null → name 顯示 "(未命名)"
 *   5) 多老師混合匯出（完整 + 缺欄位 + experts=null）時 header 不會互相污染，
 *      每份 mentor 檔的週別行位置仍固定於 index 2。
 */

const HARNESS_URL = '/e2e/journals-export-harness';
const WEEK_LINE_RE = /^-\s*週別[：:]\s*\d{4}-\d{2}-\d{2}\s*~\s*\d{4}-\d{2}-\d{2}\s*$/;

const EXPECTED_HEADER_ORDER = [
  { idx: 2, name: 'week',     match: (l: string) => WEEK_LINE_RE.test(l) },
  { idx: 3, name: 'slug',     match: (l: string) => /^-\s*Slug[：:]\s*`.+`\s*$/.test(l) },
  { idx: 4, name: 'asset',    match: (l: string) => /^-\s*資產類別[：:]\s*.+$/.test(l) },
  { idx: 5, name: 'currency', match: (l: string) => /^-\s*幣別[：:]\s*.+$/.test(l) },
  { idx: 6, name: 'count',    match: (l: string) => /^-\s*則數[：:]\s*\d+\s*$/.test(l) },
];

function assertWeekLinePosition(md: string, ctx: string) {
  const normalized = md.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  expect(lines.length, `[${ctx}] 檔案不得為空`).toBeGreaterThan(9);
  expect(lines[0], `[${ctx}] 第 1 行必須是 H1「# … 週記」`).toMatch(/^#\s+.+\s+週記\s*$/);
  expect(lines[1], `[${ctx}] 第 2 行必須為空白`).toBe('');

  for (const { idx, name, match } of EXPECTED_HEADER_ORDER) {
    expect(match(lines[idx]), `[${ctx}] 第 ${idx + 1} 行應為 ${name}，實際："${lines[idx]}"`).toBe(true);
  }
  expect(lines[7], `[${ctx}] header 區塊後應為空白`).toBe('');
  expect(lines[8], `[${ctx}] 第 9 行應為分隔線 '---'`).toBe('---');

  const allWeekIdx = lines
    .map((l, i) => (WEEK_LINE_RE.test(l) ? i : -1))
    .filter((i) => i >= 0);
  expect(allWeekIdx, `[${ctx}] 週別行必須恰好出現一次於 index 2`).toEqual([2]);
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

async function gotoHarness(page: Page) {
  const errors: string[] = [];
  const IGNORE = [/traffic-ingest/i, /CORS/i, /Failed to load resource/i, /ERR_FAILED/i];
  const shouldKeep = (s: string) => !IGNORE.some((re) => re.test(s));
  page.on('pageerror', (e) => {
    const s = String(e);
    if (shouldKeep(s)) errors.push(s);
  });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const s = m.text();
    if (shouldKeep(s)) errors.push(s);
  });
  await page.goto(HARNESS_URL);
  await expect(page.getByTestId('je-status')).toHaveText('idle');
  return { errors };
}


test.describe('Journals export — 缺失 slug/資產/幣別的健壯性', () => {
  test('slug/asset/currency 皆為 null：header 仍完整、週別行位置固定', async ({ page }) => {
    const { errors } = await gotoHarness(page);
    const { filename, buf } = await downloadFrom(page, 'je-export-missing-fields');
    const md = buf.toString('utf8');
    const ctx = `missing-fields/${filename}`;

    assertWeekLinePosition(md, ctx);

    // slug fallback → expert_id，反映在檔名 & Slug 行
    expect(filename, `[${ctx}] 檔名應以 expert_id 作為 slug fallback`).toContain('expert-e');
    const lines = md.split('\n');
    expect(lines[3]).toBe('- Slug：`expert-e`');
    // asset / currency fallback 為 '-'
    expect(lines[4]).toBe('- 資產類別：-');
    expect(lines[5]).toBe('- 幣別：-');
    // name 仍顯示原字串（不是 (未命名)）
    expect(lines[0]).toBe('# 缺欄位老師 週記');
    // 兩筆訊號 → 則數 2
    expect(lines[6]).toBe('- 則數：2');

    expect(errors, `[${ctx}] 匯出時不得產生 console / page error`).toEqual([]);
  });

  test('experts 物件為 null：name fallback 為 (未命名)、其餘 header 位置不變', async ({ page }) => {
    const { errors } = await gotoHarness(page);
    const { filename, buf } = await downloadFrom(page, 'je-export-no-experts');
    const md = buf.toString('utf8');
    const ctx = `no-experts/${filename}`;

    assertWeekLinePosition(md, ctx);

    expect(filename, `[${ctx}] 檔名應以 expert_id 作為 slug fallback`).toContain('expert-f');
    const lines = md.split('\n');
    expect(lines[0]).toBe('# (未命名) 週記');
    expect(lines[3]).toBe('- Slug：`expert-f`');
    expect(lines[4]).toBe('- 資產類別：-');
    expect(lines[5]).toBe('- 幣別：-');
    expect(lines[6]).toBe('- 則數：1');

    expect(errors, `[${ctx}] 匯出時不得產生 console / page error`).toEqual([]);
  });

  test('多老師混合（完整 + 缺欄位 + experts=null）：每份檔 header 獨立且週別行固定', async ({ page }) => {
    const { errors } = await gotoHarness(page);
    const { filename, buf } = await downloadFrom(page, 'je-export-multi-missing-mixed');

    expect(filename.endsWith('.zip'), `zip 匯出檔名應為 .zip：${filename}`).toBe(true);
    const files = await readZipContents(buf);
    const names = Object.keys(files).sort();
    expect(names, 'zip 應包含三份 mentor Markdown（完整 slug 兩位 + expert_id fallback 兩位）').toEqual(
      ['expert-e.md', 'expert-f.md', 'master-zhou.md'].sort(),
    );

    // 每份都做 header/week-line 檢查
    for (const n of names) assertWeekLinePosition(files[n], `multi-missing-mixed/${n}`);

    // 交叉污染檢查：完整老師的資產（台股/TWD）不能出現在缺欄位老師的 header
    const eLines = files['expert-e.md'].split('\n');
    expect(eLines[4]).toBe('- 資產類別：-');
    expect(eLines[5]).toBe('- 幣別：-');
    expect(eLines[3]).toBe('- Slug：`expert-e`');

    const fLines = files['expert-f.md'].split('\n');
    expect(fLines[4]).toBe('- 資產類別：-');
    expect(fLines[5]).toBe('- 幣別：-');
    expect(fLines[3]).toBe('- Slug：`expert-f`');
    expect(fLines[0]).toBe('# (未命名) 週記');

    const aLines = files['master-zhou.md'].split('\n');
    // 完整老師仍呈現原本資料，不會被 '-' 覆蓋
    expect(aLines[3]).toBe('- Slug：`master-zhou`');
    expect(aLines[4]).not.toBe('- 資產類別：-');
    expect(aLines[5]).not.toBe('- 幣別：-');

    expect(errors, `[mixed] 匯出時不得產生 console / page error`).toEqual([]);
  });
});
