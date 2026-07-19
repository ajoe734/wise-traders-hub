import { test, expect, type Page } from '@playwright/test';
import JSZip from 'jszip';

/**
 * Regression: 針對「- 週別：YYYY-MM-DD ~ YYYY-MM-DD」整行做**字面快照**，
 * 確保缺失 slug / asset / currency / experts 物件的情境下，
 * fallback 邏輯只影響對應欄位，**絕不改寫**週別行的任何字元
 * （包含全形冒號「：」、單一半形空白、波浪號「~」等）。
 *
 * 覆蓋：
 *   1) missing-fields 單檔（slug/asset/currency = null）
 *   2) no-experts 單檔（experts 物件為 null）
 *   3) multi-missing-mixed zip 內三份檔（完整 + 兩份缺欄位）
 *   4) 覆寫週別（?start=&end=）跨月／跨年 → 字面亦必須逐字對齊
 */

const HARNESS_URL = '/e2e/journals-export-harness';

// 完整字元對照（含全形冒號、半形空白、~）；不得使用 regex，這是「字面」測試。
function weekLineLiteral(start: string, end: string) {
  return `- 週別：${start} ~ ${end}`;
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
 * 對 markdown 做字面斷言：
 *   - 週別行必須「一字不差」等於 expected（含前後無多餘空白）
 *   - 必定位於 index 2（第 3 行）
 *   - 全檔僅出現一次
 */
function assertWeekLineLiteral(md: string, expected: string, ctx: string) {
  const normalized = md.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  expect(lines[2], `[${ctx}] 週別行必須字面等於 "${expected}"`).toBe(expected);

  // 精準統計出現次數：僅整行完全相等才算，避免子字串誤判
  const occurrences = lines.filter((l) => l === expected).length;
  expect(occurrences, `[${ctx}] 週別行字面必須恰好出現一次`).toBe(1);

  // 防止 fallback 誤把週別欄位改成 "-" 或空字串
  expect(lines[2]).not.toBe('- 週別：-');
  expect(lines[2]).not.toBe('- 週別：');
  expect(lines[2]).not.toContain('undefined');
  expect(lines[2]).not.toContain('null');
  expect(lines[2]).not.toContain('(未命名)');
}

test.describe('Journals export — 週別整行字面快照（缺欄位情境）', () => {
  test('missing-fields 單檔：週別行字面完全一致', async ({ page }) => {
    await gotoHarness(page);
    const expected = weekLineLiteral('2026-07-13', '2026-07-19');
    const { filename, buf } = await downloadFrom(page, 'je-export-missing-fields');
    assertWeekLineLiteral(buf.toString('utf8'), expected, `missing-fields/${filename}`);
  });

  test('no-experts 單檔：週別行字面完全一致', async ({ page }) => {
    await gotoHarness(page);
    const expected = weekLineLiteral('2026-07-13', '2026-07-19');
    const { filename, buf } = await downloadFrom(page, 'je-export-no-experts');
    assertWeekLineLiteral(buf.toString('utf8'), expected, `no-experts/${filename}`);
  });

  test('multi-missing-mixed zip：三份檔案週別行字面皆與完整老師一致', async ({ page }) => {
    await gotoHarness(page);
    const expected = weekLineLiteral('2026-07-13', '2026-07-19');
    const { filename, buf } = await downloadFrom(page, 'je-export-multi-missing-mixed');
    expect(filename.endsWith('.zip')).toBe(true);

    const files = await readZip(buf);
    const names = Object.keys(files).sort();
    expect(names).toEqual(['expert-e.md', 'expert-f.md', 'master-zhou.md']);

    for (const n of names) assertWeekLineLiteral(files[n], expected, `mixed/${n}`);

    // 跨檔字面必須完全一致：把三份的 index 2 收集起來去重
    const set = new Set(names.map((n) => files[n].replace(/\r\n/g, '\n').split('\n')[2]));
    expect(set.size, '三份 mentor 檔的週別行字面必須完全相同').toBe(1);
    expect([...set][0]).toBe(expected);
  });

  test('覆寫週別（跨月）：缺欄位情境仍保留新區間字面', async ({ page }) => {
    const s = '2026-07-27';
    const e = '2026-08-02';
    await gotoHarness(page, s, e);
    const expected = weekLineLiteral(s, e);

    for (const tid of ['je-export-missing-fields', 'je-export-no-experts']) {
      const { filename, buf } = await downloadFrom(page, tid);
      assertWeekLineLiteral(buf.toString('utf8'), expected, `cross-month/${tid}/${filename}`);
      expect(buf.toString('utf8')).not.toContain('2026-07-13');
      expect(buf.toString('utf8')).not.toContain('2026-07-19');
    }

    const { buf } = await downloadFrom(page, 'je-export-multi-missing-mixed');
    const files = await readZip(buf);
    for (const [n, md] of Object.entries(files)) {
      assertWeekLineLiteral(md, expected, `cross-month-mixed/${n}`);
    }
  });

  test('覆寫週別（跨年）：缺欄位情境仍保留新區間字面', async ({ page }) => {
    const s = '2026-12-28';
    const e = '2027-01-03';
    await gotoHarness(page, s, e);
    const expected = weekLineLiteral(s, e);

    for (const tid of ['je-export-missing-fields', 'je-export-no-experts']) {
      const { filename, buf } = await downloadFrom(page, tid);
      assertWeekLineLiteral(buf.toString('utf8'), expected, `cross-year/${tid}/${filename}`);
    }

    const { buf } = await downloadFrom(page, 'je-export-multi-missing-mixed');
    const files = await readZip(buf);
    for (const [n, md] of Object.entries(files)) {
      assertWeekLineLiteral(md, expected, `cross-year-mixed/${n}`);
    }
  });
});
