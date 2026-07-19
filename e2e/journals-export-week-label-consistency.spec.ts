import { test, expect } from '@playwright/test';
import JSZip from 'jszip';

const HARNESS_URL = '/e2e/journals-export-harness';

/**
 * Regression: 匯出檔內的「週別」標籤與 zip 檔名的日期範圍
 * 必須與 fixture 一致，且在單一 zip 中「所有老師檔」的週別
 * 完全相同，不會發生跨檔漂移（例如某位老師顯示上週）。
 *
 * 覆蓋範圍：
 *   1) 預設週別（2026-07-13 ~ 2026-07-19）— multi、multi-mixed 兩顆按鈕
 *   2) 覆寫週別（?start=&end=）— 跨月、跨年兩組區間
 *   3) 單一老師 .md 檔名也必須嵌入相同區間
 */

const WEEK_LINE_RE = /^-\s*週別[：:]\s*(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})\s*$/m;

async function downloadFrom(page: import('@playwright/test').Page, testId: string) {
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

function assertWeekLine(md: string, start: string, end: string, ctx: string) {
  const m = md.match(WEEK_LINE_RE);
  expect(m, `[${ctx}] 週別必須存在且格式為「- 週別：YYYY-MM-DD ~ YYYY-MM-DD」`).toBeTruthy();
  if (!m) return;
  expect(m[1], `[${ctx}] 週別起始日必須與 fixture 對齊`).toBe(start);
  expect(m[2], `[${ctx}] 週別結束日必須與 fixture 對齊`).toBe(end);
  // 只能出現一次，禁止重複或跨區段漂移
  const all = md.match(new RegExp(WEEK_LINE_RE.source, 'gm'));
  expect(all?.length ?? 0, `[${ctx}] 週別在單一檔案內只能出現一次`).toBe(1);
}

async function gotoRange(page: import('@playwright/test').Page, start?: string, end?: string) {
  const q = start && end ? `?start=${start}&end=${end}` : '';
  await page.goto(`${HARNESS_URL}${q}`);
  await expect(page.getByTestId('je-status')).toHaveText('idle');
  const shown = await page.getByTestId('je-week-display').textContent();
  const expected = start && end ? `${start} ~ ${end}` : '2026-07-13 ~ 2026-07-19';
  expect(shown?.trim()).toBe(expected);
}

test.describe('Journals export — 週別/日期範圍一致性', () => {
  test('預設週別：multi zip 內兩位老師的週別完全一致', async ({ page }) => {
    await gotoRange(page);
    const { filename, buf } = await downloadFrom(page, 'je-export-multi');
    expect(filename).toContain('2026-07-13_to_2026-07-19');
    expect(filename.endsWith('.zip')).toBe(true);

    const files = await readZipContents(buf);
    const names = Object.keys(files).sort();
    expect(names).toEqual(['master-zhou.md', 'wendy-us.md']);
    for (const n of names) assertWeekLine(files[n], '2026-07-13', '2026-07-19', n);

    // 跨檔一致：抽出兩份的週別行做深度比對
    const lines = names.map((n) => files[n].match(WEEK_LINE_RE)![0]);
    expect(new Set(lines).size, '所有 mentor 檔的週別行必須完全一致').toBe(1);
  });

  test('預設週別：multi-mixed zip 內老周 + 助教小陳 週別完全一致', async ({ page }) => {
    await gotoRange(page);
    const { filename, buf } = await downloadFrom(page, 'je-export-multi-mixed');
    expect(filename).toContain('2026-07-13_to_2026-07-19');

    const files = await readZipContents(buf);
    const names = Object.keys(files).sort();
    expect(names).toEqual(['assistant-chen.md', 'master-zhou.md']);
    for (const n of names) assertWeekLine(files[n], '2026-07-13', '2026-07-19', n);
    const lines = names.map((n) => files[n].match(WEEK_LINE_RE)![0]);
    expect(new Set(lines).size).toBe(1);
  });

  test('單一老師：filename 與 md 內週別皆使用 fixture 範圍', async ({ page }) => {
    await gotoRange(page);
    const { filename, buf } = await downloadFrom(page, 'je-export-single');
    expect(filename).toBe('legendflow-journal-master-zhou-2026-07-13_to_2026-07-19_published.md');
    assertWeekLine(buf.toString('utf8'), '2026-07-13', '2026-07-19', 'single');
  });

  test('覆寫週別（跨月）：所有檔案採用新的區間，無舊區間殘留', async ({ page }) => {
    const start = '2026-07-27';
    const end = '2026-08-02';
    await gotoRange(page, start, end);

    const { filename, buf } = await downloadFrom(page, 'je-export-multi');
    expect(filename).toContain(`${start}_to_${end}`);
    expect(filename).not.toContain('2026-07-13');
    expect(filename).not.toContain('2026-07-19');

    const files = await readZipContents(buf);
    const names = Object.keys(files).sort();
    expect(names).toEqual(['master-zhou.md', 'wendy-us.md']);
    for (const n of names) {
      assertWeekLine(files[n], start, end, n);
      expect(files[n], `[${n}] 不得殘留舊區間 2026-07-13`).not.toContain('2026-07-13');
      expect(files[n], `[${n}] 不得殘留舊區間 2026-07-19`).not.toContain('2026-07-19');
    }
    const lines = names.map((n) => files[n].match(WEEK_LINE_RE)![0]);
    expect(new Set(lines).size).toBe(1);
  });

  test('覆寫週別（跨年）：multi-mixed 三種按鈕皆同步採用新區間', async ({ page }) => {
    const start = '2026-12-28';
    const end = '2027-01-03';
    await gotoRange(page, start, end);

    // multi
    {
      const { filename, buf } = await downloadFrom(page, 'je-export-multi');
      expect(filename).toContain(`${start}_to_${end}`);
      const files = await readZipContents(buf);
      for (const [n, md] of Object.entries(files)) assertWeekLine(md, start, end, `multi/${n}`);
      const lines = Object.values(files).map((md) => md.match(WEEK_LINE_RE)![0]);
      expect(new Set(lines).size).toBe(1);
    }

    // multi-mixed
    {
      const { filename, buf } = await downloadFrom(page, 'je-export-multi-mixed');
      expect(filename).toContain(`${start}_to_${end}`);
      const files = await readZipContents(buf);
      for (const [n, md] of Object.entries(files)) assertWeekLine(md, start, end, `mixed/${n}`);
      const lines = Object.values(files).map((md) => md.match(WEEK_LINE_RE)![0]);
      expect(new Set(lines).size).toBe(1);
    }

    // single 也一併驗證檔名帶新區間
    {
      const { filename, buf } = await downloadFrom(page, 'je-export-single');
      expect(filename).toBe(
        `legendflow-journal-master-zhou-${start}_to_${end}_published.md`,
      );
      assertWeekLine(buf.toString('utf8'), start, end, 'single');
    }
  });
});
