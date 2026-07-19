import { test, expect } from '@playwright/test';
import JSZip from 'jszip';

/**
 * Regression: 每位老師匯出檔的檔名、slug 與 zip 內防重複
 *
 * 斷言：
 *   1) 外層 zip 檔名 = legendflow-journals-<start>_to_<end>_published.zip
 *   2) 內層每份 .md = <slug>.md，slug 必須符合 kebab-case 白名單
 *   3) 每個 slug 在同一份 zip 內只出現一次（無覆蓋 / 無碰撞）
 *   4) 每份 .md 內文的「Slug：`<slug>`」與「週別：<start> ~ <end>」與檔名對齊
 *   5) 單一老師分支：檔名為 legendflow-journal-<slug>-<start>_to_<end>_published.md
 *   6) 跨老師內容不外洩（用 fixture 專屬 marker 驗證）
 */

const HARNESS_URL = '/e2e/journals-export-harness';
const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/; // kebab-case
const WEEK_LINE_RE = /^-\s*週別[：:]\s*(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})\s*$/m;
const SLUG_LINE_RE = /^-\s*Slug[：:]\s*`([^`]+)`\s*$/m;

const EXPECTED_SLUGS: Record<string, string> = {
  'expert-a': 'master-zhou',
  'expert-b': 'wendy-us',
  'expert-c': 'assistant-chen',
  'expert-d': 'dual-unit-master',
};

// 每位老師唯一 summary marker（來自 harness fixture），用來檢查跨檔內容不外洩
const MENTOR_MARKERS: Record<string, string[]> = {
  'master-zhou': ['A-summary-alpha', 'A-summary-beta'],
  'wendy-us': ['B-summary-alpha'],
  'assistant-chen': ['C-summary-empty', 'C-summary-undefined', 'C-summary-null', 'C-summary-whitespace'],
  'dual-unit-master': ['D-summary-a', 'D-summary-b', 'D-summary-c', 'D-summary-d'],
};

async function downloadFrom(page: import('@playwright/test').Page, testId: string) {
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId(testId).click(),
  ]);
  const p = await dl.path();
  expect(p, `download for ${testId}`).toBeTruthy();
  const fs = await import('node:fs/promises');
  return { filename: dl.suggestedFilename(), buf: await fs.readFile(p!) };
}

async function readZip(buf: Buffer) {
  const zip = await JSZip.loadAsync(buf);
  const out: Record<string, string> = {};
  for (const n of Object.keys(zip.files)) out[n] = await zip.files[n].async('string');
  return out;
}

function assertZipIntegrity(
  filename: string,
  files: Record<string, string>,
  expectedSlugs: string[],
  range: { start: string; end: string },
  ctx: string,
) {
  // 1) 外層檔名
  expect(filename, `[${ctx}] zip filename 必須嵌入 ${range.start}_to_${range.end}`).toBe(
    `legendflow-journals-${range.start}_to_${range.end}_published.zip`,
  );

  // 2) 內層檔名 = <slug>.md，且無多餘目錄／夾雜
  const names = Object.keys(files).sort();
  expect(names, `[${ctx}] zip 內檔案清單`).toEqual(expectedSlugs.slice().sort().map((s) => `${s}.md`));

  for (const n of names) {
    const slug = n.replace(/\.md$/, '');
    expect(n.endsWith('.md'), `[${ctx}/${n}] 必須為 .md`).toBe(true);
    expect(n.includes('/'), `[${ctx}/${n}] 不得含子目錄`).toBe(false);
    expect(SLUG_RE.test(slug), `[${ctx}/${n}] slug 必須 kebab-case`).toBe(true);
  }

  // 3) 無重複／覆蓋（Object.keys 天然去重，但 zip.file 可能被覆蓋 → 靠 rows 數量檢查）
  expect(new Set(names).size, `[${ctx}] 檔名不可重複`).toBe(names.length);

  // 4) 內文 Slug/週別/一致性
  for (const n of names) {
    const slug = n.replace(/\.md$/, '');
    const md = files[n];
    const wm = md.match(WEEK_LINE_RE);
    expect(wm, `[${ctx}/${n}] 週別行必須存在`).toBeTruthy();
    expect(wm![1]).toBe(range.start);
    expect(wm![2]).toBe(range.end);

    const sm = md.match(SLUG_LINE_RE);
    expect(sm, `[${ctx}/${n}] Slug 行必須存在`).toBeTruthy();
    expect(sm![1], `[${ctx}/${n}] 內文 slug 必須與檔名 slug 一致`).toBe(slug);
  }

  // 6) 跨檔內容不外洩
  for (const n of names) {
    const slug = n.replace(/\.md$/, '');
    const own = MENTOR_MARKERS[slug] ?? [];
    for (const m of own) {
      expect(files[n], `[${ctx}/${n}] 自己的 marker ${m} 必須存在`).toContain(m);
    }
    for (const [otherSlug, markers] of Object.entries(MENTOR_MARKERS)) {
      if (otherSlug === slug) continue;
      for (const m of markers) {
        expect(files[n], `[${ctx}/${n}] 不得洩漏 ${otherSlug} 的 marker ${m}`).not.toContain(m);
      }
    }
  }
}

const RANGES = [
  { start: '2026-07-13', end: '2026-07-19', label: '預設' },
  { start: '2026-07-27', end: '2026-08-02', label: '跨月' },
  { start: '2026-12-28', end: '2027-01-03', label: '跨年' },
];

async function gotoRange(page: import('@playwright/test').Page, start?: string, end?: string) {
  const q = start && end ? `?start=${start}&end=${end}` : '';
  await page.goto(`${HARNESS_URL}${q}`);
  await expect(page.getByTestId('je-status')).toHaveText('idle');
}

test.describe('Journals export — zip 內檔名/slug/防碰撞完整性', () => {
  for (const r of RANGES) {
    test(`${r.label}（${r.start}~${r.end}）multi zip：master-zhou + wendy-us 各自獨立`, async ({ page }) => {
      await gotoRange(page, r.start, r.end);
      const { filename, buf } = await downloadFrom(page, 'je-export-multi');
      const files = await readZip(buf);
      assertZipIntegrity(filename, files, ['master-zhou', 'wendy-us'], r, `multi/${r.label}`);
    });

    test(`${r.label} multi-mixed zip：master-zhou + assistant-chen 各自獨立`, async ({ page }) => {
      await gotoRange(page, r.start, r.end);
      const { filename, buf } = await downloadFrom(page, 'je-export-multi-mixed');
      const files = await readZip(buf);
      assertZipIntegrity(filename, files, ['master-zhou', 'assistant-chen'], r, `mixed/${r.label}`);
    });
  }

  test('single mentor：檔名 = legendflow-journal-<slug>-<range>_published.md 且 slug/週別對齊', async ({ page }) => {
    const r = { start: '2026-07-13', end: '2026-07-19' };
    await gotoRange(page, r.start, r.end);
    const { filename, buf } = await downloadFrom(page, 'je-export-single');
    expect(filename).toBe(`legendflow-journal-master-zhou-${r.start}_to_${r.end}_published.md`);

    const md = buf.toString('utf8');
    const wm = md.match(WEEK_LINE_RE);
    expect(wm && wm[1]).toBe(r.start);
    expect(wm && wm[2]).toBe(r.end);
    const sm = md.match(SLUG_LINE_RE);
    expect(sm && sm[1]).toBe('master-zhou');

    // 只含自己的 marker
    for (const m of MENTOR_MARKERS['master-zhou']) expect(md).toContain(m);
    for (const [otherSlug, markers] of Object.entries(MENTOR_MARKERS)) {
      if (otherSlug === 'master-zhou') continue;
      for (const m of markers) expect(md, `不得洩漏 ${otherSlug} 的 ${m}`).not.toContain(m);
    }
  });

  test('single mentor：dual-unit-master 檔名/slug 對齊且不與其他老師混雜', async ({ page }) => {
    const r = { start: '2026-07-13', end: '2026-07-19' };
    await gotoRange(page, r.start, r.end);
    const { filename, buf } = await downloadFrom(page, 'je-export-dual-unit');
    expect(filename).toBe(`legendflow-journal-dual-unit-master-${r.start}_to_${r.end}_published.md`);

    const md = buf.toString('utf8');
    expect(md.match(SLUG_LINE_RE)?.[1]).toBe('dual-unit-master');
    for (const m of MENTOR_MARKERS['dual-unit-master']) expect(md).toContain(m);
    for (const otherSlug of ['master-zhou', 'wendy-us', 'assistant-chen']) {
      for (const m of MENTOR_MARKERS[otherSlug]) expect(md).not.toContain(m);
    }
  });

  test('single mentor：empty-unit 分支 = assistant-chen 檔名一致', async ({ page }) => {
    const r = { start: '2026-07-13', end: '2026-07-19' };
    await gotoRange(page, r.start, r.end);
    const { filename, buf } = await downloadFrom(page, 'je-export-empty-unit');
    expect(filename).toBe(`legendflow-journal-assistant-chen-${r.start}_to_${r.end}_published.md`);

    const md = buf.toString('utf8');
    expect(md.match(SLUG_LINE_RE)?.[1]).toBe('assistant-chen');
  });

  test('重複下載 multi 兩次：每次 zip 內檔名／slug 均一致，且無累積殘留', async ({ page }) => {
    const r = { start: '2026-07-13', end: '2026-07-19' };
    await gotoRange(page, r.start, r.end);

    const first = await downloadFrom(page, 'je-export-multi');
    const second = await downloadFrom(page, 'je-export-multi');
    expect(first.filename).toBe(second.filename);

    const a = await readZip(first.buf);
    const b = await readZip(second.buf);
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    assertZipIntegrity(first.filename, a, ['master-zhou', 'wendy-us'], r, 'repeat-1');
    assertZipIntegrity(second.filename, b, ['master-zhou', 'wendy-us'], r, 'repeat-2');
  });
});
