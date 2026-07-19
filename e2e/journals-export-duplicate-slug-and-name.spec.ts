import { test, expect, type Page, type Download } from '@playwright/test';
import JSZip from 'jszip';

/**
 * Regression: 多檔 zip 內若出現「同名週記標題」、「slug 撞名」、「slug fallback 撞名」、
 * 「重複 expert_id」等情境時，必須確認：
 *   1. 檔名唯一（不同 expert_id 的 slug 撞名時自動 dedup，例如追加 -<expert_id>）
 *   2. 每份檔案週別行仍嚴格位於 index 2
 *   3. 每份檔案內容僅含自己的獨特 token（learning_points），不含對方獨特 token → 無跨老師污染
 *   4. 相同 expert_id 的多筆 rows 會被聚合成同一檔案，不會重複產出
 *
 * 覆蓋 harness 按鈕：
 *   - je-export-duplicate-slug          (G1 shared-slug → G2 shared-slug)
 *   - je-export-duplicate-slug-reversed (G2 → G1，順序切換仍保持隔離)
 *   - je-export-slug-fallback-clash     (H1.slug=null fallback=expert_id "clash-id" vs H2.slug="clash-id")
 *   - je-export-duplicate-expert-id     (A 重複兩次 + B → 僅 2 份檔案)
 */

const HARNESS_URL = '/e2e/journals-export-harness';
const RANGE = { start: '2026-07-13', end: '2026-07-19' };

async function gotoHarness(page: Page) {
  await page.goto(`${HARNESS_URL}?start=${RANGE.start}&end=${RANGE.end}`);
  await expect(page.getByTestId('je-status')).toHaveText('idle');
}

async function downloadFrom(page: Page, testId: string) {
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId(testId).click(),
  ]);
  return dl;
}

async function readDownload(dl: Download) {
  const p = await dl.path();
  expect(p).toBeTruthy();
  const fs = await import('node:fs/promises');
  return { filename: dl.suggestedFilename(), buf: await fs.readFile(p!) };
}

async function unzipAll(buf: Buffer) {
  const zip = await JSZip.loadAsync(buf);
  const contents: Record<string, string> = {};
  for (const n of Object.keys(zip.files)) {
    if (!zip.files[n].dir && n.endsWith('.md')) {
      contents[n] = await zip.files[n].async('string');
    }
  }
  return contents;
}

function normalize(md: string) {
  return md.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

const WEEK_RE = /^-\s*週別\s*[：:]\s*(\d{4}-\d{2}-\d{2})\s*[~〜～]\s*(\d{4}-\d{2}-\d{2})\s*$/;

function countOccurrences(hay: string, needle: string) {
  if (!needle) return 0;
  let i = 0;
  let n = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) {
    n++;
    i += needle.length;
  }
  return n;
}

function assertWeekLine(md: string, ctx: string) {
  const lines = normalize(md);
  const m = lines[2]?.match(WEEK_RE);
  expect(m, `[${ctx}] 週別行必須位於 index 2，實際 lines[2]=${JSON.stringify(lines[2])}`).not.toBeNull();
  expect(m![1], `[${ctx}] start`).toBe(RANGE.start);
  expect(m![2], `[${ctx}] end`).toBe(RANGE.end);
  // 全檔僅一行「週別：」
  const hits = lines.filter((l) => /週別\s*[：:]/.test(l));
  expect(hits.length, `[${ctx}] 全檔僅能一行含「週別：」`).toBe(1);
}

test.describe('Journals export — 同名週記／slug 撞名／重複 expert_id 隔離', () => {
  test('duplicate slug: 兩位不同 expert_id 共用 shared-slug → 檔名 dedup 且無污染', async ({ page }) => {
    await gotoHarness(page);
    const dl = await downloadFrom(page, 'je-export-duplicate-slug');
    const { filename, buf } = await readDownload(dl);
    expect(filename.endsWith('.zip'), `檔案類型：${filename}`).toBe(true);

    const contents = await unzipAll(buf);
    const names = Object.keys(contents);

    // 兩位老師 → 2 份檔案，檔名必須唯一
    expect(names.length, `檔名列表：${names.join(', ')}`).toBe(2);
    expect(new Set(names).size, '檔名必須唯一').toBe(2);
    // 至少有一份仍是 shared-slug.md（先加入者保留原名）
    expect(names.some((n) => n === 'shared-slug.md'), `應保留 shared-slug.md：${names}`).toBe(true);
    // 另一份必須帶有 dedup 後綴（-expert-g1 或 -expert-g2）
    expect(
      names.some((n) => /^shared-slug-expert-g[12]\.md$/.test(n)),
      `dedup 後綴檔名缺失：${names}`,
    ).toBe(true);

    for (const [n, md] of Object.entries(contents)) assertWeekLine(md, n);

    // 跨檔污染：G1/G2 各自 learning_points token 必須僅出現在自家檔案
    // 依 buildJournalExport 迭代 map 順序，先加入的檔案為 shared-slug.md
    // 找出「內文含 G1-learning-token」的檔案，另一份不得含 G1 token，反之亦然
    const g1File = names.find((n) => contents[n].includes('G1-learning-token'))!;
    const g2File = names.find((n) => contents[n].includes('G2-learning-token'))!;
    expect(g1File, 'G1 應有專屬檔案').toBeTruthy();
    expect(g2File, 'G2 應有專屬檔案').toBeTruthy();
    expect(g1File).not.toBe(g2File);
    expect(countOccurrences(contents[g1File], 'G2-learning-token'), 'G1 檔不得含 G2 token').toBe(0);
    expect(countOccurrences(contents[g2File], 'G1-learning-token'), 'G2 檔不得含 G1 token').toBe(0);
    expect(countOccurrences(contents[g1File], '同名老師乙'), 'G1 檔不得含 G2 name').toBe(0);
    expect(countOccurrences(contents[g2File], '同名老師甲'), 'G2 檔不得含 G1 name').toBe(0);
    // 各自 header 應含自己 name
    expect(contents[g1File]).toContain('# 同名老師甲 週記');
    expect(contents[g2File]).toContain('# 同名老師乙 週記');
  });

  test('duplicate slug reversed: 輸入順序切換後仍 dedup 且無污染', async ({ page }) => {
    await gotoHarness(page);
    const dl = await downloadFrom(page, 'je-export-duplicate-slug-reversed');
    const { filename, buf } = await readDownload(dl);
    expect(filename.endsWith('.zip')).toBe(true);
    const contents = await unzipAll(buf);
    const names = Object.keys(contents);
    expect(names.length, `檔名：${names.join(', ')}`).toBe(2);
    expect(new Set(names).size).toBe(2);
    for (const [n, md] of Object.entries(contents)) assertWeekLine(md, n);

    const g1File = names.find((n) => contents[n].includes('G1-learning-token'))!;
    const g2File = names.find((n) => contents[n].includes('G2-learning-token'))!;
    expect(g1File).toBeTruthy();
    expect(g2File).toBeTruthy();
    expect(g1File).not.toBe(g2File);
    expect(countOccurrences(contents[g1File], 'G2-learning-token')).toBe(0);
    expect(countOccurrences(contents[g2File], 'G1-learning-token')).toBe(0);
  });

  test('slug fallback 撞名: H1.slug=null(fallback=expert_id) vs H2.slug=同字串 → dedup 且無污染', async ({ page }) => {
    await gotoHarness(page);
    const dl = await downloadFrom(page, 'je-export-slug-fallback-clash');
    const { filename, buf } = await readDownload(dl);
    expect(filename.endsWith('.zip')).toBe(true);
    const contents = await unzipAll(buf);
    const names = Object.keys(contents);
    expect(names.length, `檔名：${names.join(', ')}`).toBe(2);
    expect(new Set(names).size).toBe(2);
    // 應該有一份為 clash-id.md
    expect(names.includes('clash-id.md'), `應保留 clash-id.md：${names}`).toBe(true);
    for (const [n, md] of Object.entries(contents)) assertWeekLine(md, n);

    const h1File = names.find((n) => contents[n].includes('H1-token'))!;
    const h2File = names.find((n) => contents[n].includes('H2-token'))!;
    expect(h1File).toBeTruthy();
    expect(h2File).toBeTruthy();
    expect(h1File).not.toBe(h2File);
    expect(countOccurrences(contents[h1File], 'H2-token')).toBe(0);
    expect(countOccurrences(contents[h2File], 'H1-token')).toBe(0);
    expect(countOccurrences(contents[h1File], 'H2老師')).toBe(0);
    expect(countOccurrences(contents[h2File], 'H1老師')).toBe(0);
  });

  test('duplicate expert_id: 同 expert_id 多筆 rows → 聚合為單一檔案，不重複產出', async ({ page }) => {
    await gotoHarness(page);
    const dl = await downloadFrom(page, 'je-export-duplicate-expert-id');
    const { filename, buf } = await readDownload(dl);
    expect(filename.endsWith('.zip')).toBe(true);
    const contents = await unzipAll(buf);
    const names = Object.keys(contents);
    // A(重複兩批 rows) + B → 僅 2 份檔案
    expect(names.length, `檔名：${names.join(', ')}`).toBe(2);
    expect(new Set(names).size).toBe(2);
    expect(names.includes('master-zhou.md'), `應包含 master-zhou.md：${names}`).toBe(true);
    expect(names.includes('wendy-us.md'), `應包含 wendy-us.md：${names}`).toBe(true);

    for (const [n, md] of Object.entries(contents)) assertWeekLine(md, n);

    const aMd = contents['master-zhou.md'];
    const bMd = contents['wendy-us.md'];
    // A 檔應包含所有 A 系列 rows（含 sig-a-dup 的 token）
    expect(aMd).toContain('A-learning-alpha');
    expect(aMd).toContain('A-learning-dup-token');
    // 則數應為 A 系列 rows 總筆數（2 + 1 = 3）
    expect(aMd).toContain('- 則數：3');
    // B 檔不得含 A tokens；A 檔不得含 B tokens
    expect(countOccurrences(aMd, 'B-learning-alpha')).toBe(0);
    expect(countOccurrences(aMd, 'Wendy')).toBe(0);
    expect(countOccurrences(bMd, 'A-learning-alpha')).toBe(0);
    expect(countOccurrences(bMd, 'A-learning-dup-token')).toBe(0);
    expect(countOccurrences(bMd, '老周')).toBe(0);
  });

  test('全部 duplicate 情境串跑不得產生 console/page error', async ({ page }) => {
    const errors: string[] = [];
    const IGNORE_RE = /(traffic-ingest|Access-Control-Allow-Origin|ERR_FAILED|Failed to load resource)/i;
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const t = m.text();
      if (IGNORE_RE.test(t)) return;
      errors.push(`console: ${t}`);
    });
    await gotoHarness(page);
    for (const btn of [
      'je-export-duplicate-slug',
      'je-export-duplicate-slug-reversed',
      'je-export-slug-fallback-clash',
      'je-export-duplicate-expert-id',
    ]) {
      await readDownload(await downloadFrom(page, btn));
    }
    expect(errors, `不得產生錯誤：\n${errors.join('\n')}`).toEqual([]);
  });
});
