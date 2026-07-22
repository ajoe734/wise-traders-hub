import { test, expect } from '@playwright/test';
import JSZip from 'jszip';

/**
 * Regression: 缺失 slug / asset_class / currency（甚至 experts=null）時，
 * header 區塊的**逐行位置與 fallback 視覺呈現**必須完全符合合約：
 *
 *   L0: `# <name|(未命名)> 週記`
 *   L1: ''
 *   L2: `- 週別：YYYY-MM-DD ~ YYYY-MM-DD`
 *   L3: `- Slug：\`<slug|expert_id>\``
 *   L4: `- 資產類別：<ASSET_LABEL|raw|-> `
 *   L5: `- 幣別：<currency|-> `
 *   L6: `- 則數：N`
 *   L7: ''
 *   L8: `---`
 *
 * 覆蓋：
 *   - E 老師：slug/asset_class/currency 皆 null（experts 物件存在）→ 顯示「-」與 expert_id
 *   - F 老師：experts 物件為 null → name=(未命名)、Slug=expert-f、資產/幣別皆「-」
 *   - Multi-missing-mixed：完整 + E + F 混合匯出於同一 zip，任一 mentor 不得污染他人 header
 *
 * 反向斷言（禁止字面）：
 *   - Slug 行不得出現 `null` / `undefined`
 *   - 資產類別 / 幣別行不得出現 `null` / `undefined`
 *   - name 為 null 時不得出現 `# null 週記` 或 `#  週記`
 */

const HARNESS_URL = '/e2e/journals-export-harness';
const RANGE = { start: '2026-07-13', end: '2026-07-19' };

type HeaderExpectation = {
  name: string;              // 完整 H1 顯示（含 fallback）
  slug: string;              // Slug 行反引號內字面
  asset: string;             // 資產類別行值
  currency: string;          // 幣別行值
  count: number;             // 則數
};

const EXPECT_E: HeaderExpectation = {
  name: '缺欄位老師',
  slug: 'expert-e',   // fallback：null → expert_id
  asset: '-',         // fallback：null → '-'
  currency: '-',      // fallback：null → '-'
  count: 2,
};

const EXPECT_F: HeaderExpectation = {
  name: '(未命名)',   // experts 為 null → 全域 fallback
  slug: 'expert-f',
  asset: '-',
  currency: '-',
  count: 1,
};

// A 老師（完整資料）作為對照組，確認 fallback 不會反向污染正常資料
const EXPECT_A: HeaderExpectation = {
  name: '老周',
  slug: 'master-zhou',
  asset: '台股', // ASSET_LABEL['tw_stock']
  currency: 'TWD',
  count: 2,
};

async function gotoHarness(page: import('@playwright/test').Page) {
  await page.goto(`${HARNESS_URL}?start=${RANGE.start}&end=${RANGE.end}`);
  await expect(page.getByTestId('je-status')).toHaveText('idle');
}

async function downloadFrom(page: import('@playwright/test').Page, testId: string) {
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId(testId).click(),
  ]);
  const p = await dl.path();
  expect(p).toBeTruthy();
  const fs = await import('node:fs/promises');
  return { filename: dl.suggestedFilename(), buf: await fs.readFile(p!) };
}

function normalize(md: string) {
  return md.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

/**
 * 對單一 mentor markdown 全面斷言 header 位置與 fallback 字面。
 */
function assertHeader(md: string, exp: HeaderExpectation, ctx: string) {
  const lines = normalize(md);

  // 位置固定
  expect(lines[0], `[${ctx}] L0 應為 H1`).toBe(`# ${exp.name} 週記`);
  expect(lines[1], `[${ctx}] L1 應為空行`).toBe('');
  expect(lines[2], `[${ctx}] L2 週別行`).toBe(`- 週別：${RANGE.start} ~ ${RANGE.end}`);
  expect(lines[3], `[${ctx}] L3 Slug 行`).toBe(`- Slug：\`${exp.slug}\``);
  expect(lines[4], `[${ctx}] L4 資產類別行`).toBe(`- 資產類別：${exp.asset}`);
  expect(lines[5], `[${ctx}] L5 幣別行`).toBe(`- 幣別：${exp.currency}`);
  expect(lines[6], `[${ctx}] L6 則數行`).toBe(`- 則數：${exp.count}`);
  expect(lines[7], `[${ctx}] L7 空行`).toBe('');
  expect(lines[8], `[${ctx}] L8 分隔線`).toBe('---');

  // 反向：禁止字面
  const header = lines.slice(0, 9).join('\n');
  for (const forbidden of ['null', 'undefined', '(NULL)', 'NaN']) {
    expect(header.includes(forbidden), `[${ctx}] header 不得出現「${forbidden}」`).toBe(false);
  }
  // 反向：H1 不得為空 name（`#  週記` 兩個空白 或 `# 週記`）
  expect(/^# \s*週記$/.test(lines[0]), `[${ctx}] H1 不得為空 name`).toBe(false);

  // 反向：Slug/資產/幣別行值不得為空字串（fallback 一定要成功寫入）
  expect(/^- Slug：``$/.test(lines[3]), `[${ctx}] Slug 反引號內不得為空`).toBe(false);
  expect(lines[4].endsWith('：'), `[${ctx}] 資產類別行不得以冒號結尾（fallback 未套用）`).toBe(false);
  expect(lines[5].endsWith('：'), `[${ctx}] 幣別行不得以冒號結尾（fallback 未套用）`).toBe(false);

  // 全檔僅一行「週別：」，避免 header 污染
  const looseHits = lines.filter((l) => /週別\s*[：:]/.test(l));
  expect(looseHits.length, `[${ctx}] 全檔僅能有一行帶「週別：」`).toBe(1);
}

test.describe('Journals export — missing slug/asset/currency fallback rendering', () => {
  test('E 老師 (slug/asset/currency=null) → 顯示 expert_id 與「-」，header 位置固定', async ({ page }) => {
    await gotoHarness(page);
    const { filename, buf } = await downloadFrom(page, 'je-export-missing-fields');
    expect(filename.endsWith('.md'), `檔名應為 .md：${filename}`).toBe(true);
    // 檔名 slug 也走 expert_id fallback
    expect(filename.includes('expert-e'), `檔名應包含 fallback slug expert-e：${filename}`).toBe(true);
    assertHeader(buf.toString('utf8'), EXPECT_E, `single/${filename}`);
  });

  test('F 老師 (experts=null) → H1 顯示 (未命名)，Slug 走 expert_id，資產/幣別皆「-」', async ({ page }) => {
    await gotoHarness(page);
    const { filename, buf } = await downloadFrom(page, 'je-export-no-experts');
    expect(filename.endsWith('.md'), `檔名應為 .md：${filename}`).toBe(true);
    expect(filename.includes('expert-f'), `檔名應包含 fallback slug expert-f：${filename}`).toBe(true);
    assertHeader(buf.toString('utf8'), EXPECT_F, `single/${filename}`);
  });

  test('multi-missing-mixed zip：A/E/F 三位老師 header 各自正確且不互相污染', async ({ page }) => {
    await gotoHarness(page);
    const { filename, buf } = await downloadFrom(page, 'je-export-multi-missing-mixed');
    expect(filename.endsWith('.zip'), `應為 .zip：${filename}`).toBe(true);

    const zip = await JSZip.loadAsync(buf);
    const entries: Record<string, string> = {};
    for (const n of Object.keys(zip.files)) {
      if (n.endsWith('.md')) entries[n] = await zip.files[n].async('string');
    }

    // 依 slug/expert_id 對應到期望
    const findByToken = (token: string) =>
      Object.entries(entries).find(([n]) => n.includes(token))?.[1];

    const aMd = findByToken('master-zhou');
    const eMd = findByToken('expert-e');
    const fMd = findByToken('expert-f');

    expect(aMd, 'zip 內必含 master-zhou.md').toBeTruthy();
    expect(eMd, 'zip 內必含 expert-e.md (slug fallback)').toBeTruthy();
    expect(fMd, 'zip 內必含 expert-f.md (slug fallback)').toBeTruthy();

    assertHeader(aMd!, EXPECT_A, 'multi/master-zhou');
    assertHeader(eMd!, EXPECT_E, 'multi/expert-e');
    assertHeader(fMd!, EXPECT_F, 'multi/expert-f');

    // 跨檔污染反向斷言：E/F 的檔案內不得出現 A 的 name/slug，反之亦然
    expect(eMd!.includes('老周'), 'E 檔案不得出現老周').toBe(false);
    expect(eMd!.includes('master-zhou'), 'E 檔案不得出現 master-zhou').toBe(false);
    expect(fMd!.includes('老周'), 'F 檔案不得出現老周').toBe(false);
    expect(fMd!.includes('缺欄位老師'), 'F 檔案不得出現 E 的 name').toBe(false);
    expect(aMd!.includes('(未命名)'), 'A 檔案不得出現 (未命名)').toBe(false);
    expect(aMd!.includes('expert-e'), 'A 檔案不得出現 expert-e slug').toBe(false);

    // 檔名不得重複、且皆為 .md
    const names = Object.keys(entries);
    expect(new Set(names).size, '檔名不得重複').toBe(names.length);
    for (const n of names) expect(n.endsWith('.md'), `${n} 應為 .md`).toBe(true);
  });

  test('無 console/page error（缺欄位情境不得炸掉）', async ({ page }) => {
    const errors: string[] = [];
    // 忽略與匯出邏輯無關的基礎設施雜訊（analytics/telemetry CORS、資源載入失敗等）
    const IGNORE_RE = /traffic-ingest|Failed to load resource|net::ERR_|analytics|telemetry/i;
    page.on('pageerror', (e) => {
      if (!IGNORE_RE.test(e.message)) errors.push(`pageerror: ${e.message}`);
    });
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const text = m.text();
      if (IGNORE_RE.test(text)) return;
      errors.push(`console: ${text}`);
    });
    await gotoHarness(page);
    await downloadFrom(page, 'je-export-missing-fields');
    await downloadFrom(page, 'je-export-no-experts');
    await downloadFrom(page, 'je-export-multi-missing-mixed');
    expect(errors, `不得產生錯誤：\n${errors.join('\n')}`).toEqual([]);
  });
});

