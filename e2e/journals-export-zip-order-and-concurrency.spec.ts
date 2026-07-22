import { test, expect, type Page, type Download } from '@playwright/test';
import JSZip from 'jszip';

/**
 * Regression: zip 內部檔案排序（依 JSZip 迭代順序、字典序、加入順序）差異下，
 * 每份 mentor markdown 的**週別行位置必須固定 index 2**，且不得發生跨老師污染。
 * 另涵蓋「多個 zip 匯出並行下載」情境，驗證跨匯出批次的隔離性。
 *
 * 涵蓋所有會產出 .zip 的按鈕：
 *   - multi、multi-reversed、multi-mixed、multi-mixed-reversed、multi-interleaved
 *   - dual-unit、multi-missing-mixed
 *
 * 每個按鈕分別驗證：
 *   1. zip 內每份 .md 週別行嚴格位於 index 2
 *   2. 逐一以 JSZip 原始迭代順序、字典順序遍歷，結論不變
 *   3. 每份檔案的「自己 name/slug」出現次數 ≥ 1；其它 mentor 的 name/slug 出現次數必須 0（跨檔污染）
 *   4. 檔名唯一、皆為 .md，且 zip 內至少 2 份（dual-unit 為單老師例外處理）
 *   5. 跨檔一致：(lineIndex, start, end) 三元組相同
 *
 * 另有整合情境：
 *   - 依序連續匯出 5 個不同 zip，將每份下載檔案 unzip 後全部檢查一次，
 *     確保「不同批匯出的檔案互不污染」（例如 A 批的 A 老師檔內不得混入 B 批的 mentor tokens）
 */

const HARNESS_URL = '/e2e/journals-export-harness';
const RANGE = { start: '2026-07-13', end: '2026-07-19' };

// buttonId → 是否單老師 zip（dual-unit 只有一位「雙棲老師」，但依 buildJournalExport 仍會走 .md 單檔）
const ZIP_BUTTONS = [
  'je-export-multi',
  'je-export-multi-reversed',
  'je-export-multi-mixed',
  'je-export-multi-mixed-reversed',
  'je-export-multi-interleaved',
  'je-export-multi-missing-mixed',
];
// dual-unit 是「同一位老師的多幣別」，依 harness fixture 只會產出單一 .md，
// 這邊仍納入排序驗證，但用 md 分支處理。
const MAYBE_SINGLE_BUTTONS = ['je-export-dual-unit'];

const ALL_BUTTONS = [...ZIP_BUTTONS, ...MAYBE_SINGLE_BUTTONS];

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

function normalize(md: string) {
  return md.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

const WEEK_RE = /^-\s*週別\s*[：:]\s*(\d{4}-\d{2}-\d{2})\s*[~〜～]\s*(\d{4}-\d{2}-\d{2})\s*$/;
const H1_RE = /^#\s+(.+?)\s+週記\s*$/;
const SLUG_RE = /^-\s*Slug\s*[：:]\s*`([^`]+)`\s*$/;

function parseFile(md: string) {
  const lines = normalize(md);
  const h1 = lines[0]?.match(H1_RE)?.[1] ?? null;
  const week = lines[2]?.match(WEEK_RE);
  const slugLine = lines[3]?.match(SLUG_RE);
  return {
    lines,
    name: h1,
    slug: slugLine?.[1] ?? null,
    weekLineIndex: lines.findIndex((l) => WEEK_RE.test(l)),
    week: week ? { start: week[1], end: week[2] } : null,
  };
}

async function unzipAll(buf: Buffer) {
  const zip = await JSZip.loadAsync(buf);
  // 兩種遍歷順序：JSZip 原生（近似加入順序）與字典序
  const nativeOrder = Object.keys(zip.files);
  const lexicalOrder = [...nativeOrder].sort();
  const contents: Record<string, string> = {};
  for (const n of nativeOrder) {
    if (!zip.files[n].dir) contents[n] = await zip.files[n].async('string');
  }
  return { contents, nativeOrder, lexicalOrder };
}

/**
 * 對一組 mentor markdown（同一 zip 或跨 zip 集合）做污染與位置斷言。
 * @param bundle 檔名 → 內容
 * @param ctx    診斷前綴
 * @param opts   allowSelfDup: 允許 (未命名) 這類非唯一 name；strictWeek: 是否斷言週別 index=2
 */
function assertBundle(
  bundle: Record<string, string>,
  ctx: string,
  opts: { strictWeek?: boolean; expectMinFiles?: number } = {}
) {
  const strictWeek = opts.strictWeek ?? true;
  const minFiles = opts.expectMinFiles ?? 1;

  const names = Object.keys(bundle);
  expect(names.length, `[${ctx}] 至少 ${minFiles} 份檔案`).toBeGreaterThanOrEqual(minFiles);
  // 檔名唯一 + .md
  expect(new Set(names).size, `[${ctx}] 檔名必須唯一`).toBe(names.length);
  for (const n of names) expect(n.endsWith('.md'), `[${ctx}] ${n} 應為 .md`).toBe(true);

  const parsed = names.map((n) => ({ file: n, ...parseFile(bundle[n]) }));

  // 每份檔案週別行位置固定
  if (strictWeek) {
    for (const p of parsed) {
      expect(p.weekLineIndex, `[${ctx}] ${p.file} 週別行位置`).toBe(2);
      expect(p.week, `[${ctx}] ${p.file} 應可解析週別`).not.toBeNull();
      expect(p.week!.start, `[${ctx}] ${p.file} start`).toBe(RANGE.start);
      expect(p.week!.end, `[${ctx}] ${p.file} end`).toBe(RANGE.end);
    }
    // 跨檔一致
    const tuples = new Set(parsed.map((p) => `${p.weekLineIndex}|${p.week!.start}|${p.week!.end}`));
    expect(tuples.size, `[${ctx}] 跨檔 (index,start,end) 必須相同`).toBe(1);
    // 全檔僅一行「週別：」
    for (const p of parsed) {
      const hits = p.lines.filter((l) => /週別\s*[：:]/.test(l));
      expect(hits.length, `[${ctx}] ${p.file} 全檔僅能一行帶「週別：」`).toBe(1);
    }
  }

  // 跨檔污染：使用「其他檔案的 slug（去 fallback expert-x 這種也算 token）」與非 (未命名) 的 name 做偵測
  for (const self of parsed) {
    const others = parsed.filter((p) => p.file !== self.file);
    for (const other of others) {
      // slug token：唯一識別，任何檔案內出現對方 slug 都算污染
      if (other.slug) {
        // 允許同 slug 檔案（不可能，因為檔名唯一而 slug 通常內嵌於檔名）
        if (other.slug === self.slug) continue;
        const occ = countOccurrences(bundle[self.file], other.slug);
        expect(occ, `[${ctx}] ${self.file} 不得包含他人 slug「${other.slug}」`).toBe(0);
      }
      // name token：跳過 (未命名) 這類非獨特 name
      if (other.name && other.name !== '(未命名)' && other.name !== self.name) {
        const occ = countOccurrences(bundle[self.file], other.name);
        expect(occ, `[${ctx}] ${self.file} 不得包含他人 name「${other.name}」`).toBe(0);
      }
    }
    // 自我 token 至少各出現一次（在 H1 + Slug 行）
    if (self.name) {
      expect(countOccurrences(bundle[self.file], self.name), `[${ctx}] ${self.file} 應包含自己 name`).toBeGreaterThanOrEqual(1);
    }
    if (self.slug) {
      expect(countOccurrences(bundle[self.file], self.slug), `[${ctx}] ${self.file} 應包含自己 slug`).toBeGreaterThanOrEqual(1);
    }
  }
}

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

test.describe('Journals export — zip 排序與並行匯出隔離性', () => {
  for (const btn of ZIP_BUTTONS) {
    test(`${btn}: 兩種迭代順序下每份 md 週別行皆位於 index 2 且無跨老師污染`, async ({ page }) => {
      await gotoHarness(page);
      const dl = await downloadFrom(page, btn);
      const { filename, buf } = await readDownload(dl);
      expect(filename.endsWith('.zip'), `[${btn}] 應為 .zip：${filename}`).toBe(true);

      const { contents, nativeOrder, lexicalOrder } = await unzipAll(buf);

      // 排序 1：JSZip 原生迭代順序
      const orderedNative: Record<string, string> = {};
      for (const n of nativeOrder) if (n.endsWith('.md')) orderedNative[n] = contents[n];
      assertBundle(orderedNative, `${btn}/native-order`, { expectMinFiles: 2 });

      // 排序 2：字典序（模擬使用者在 Finder / Explorer 展開）
      const orderedLexical: Record<string, string> = {};
      for (const n of lexicalOrder) if (n.endsWith('.md')) orderedLexical[n] = contents[n];
      assertBundle(orderedLexical, `${btn}/lexical-order`, { expectMinFiles: 2 });

      // 排序 3：反向字典序
      const orderedReverse: Record<string, string> = {};
      for (const n of [...lexicalOrder].reverse()) if (n.endsWith('.md')) orderedReverse[n] = contents[n];
      assertBundle(orderedReverse, `${btn}/reverse-order`, { expectMinFiles: 2 });

      // 三種順序下 assertBundle 都用同一份 contents → 內容不變是隱含合約
      expect(Object.keys(orderedNative).sort()).toEqual(Object.keys(orderedLexical).sort());
    });
  }

  test('dual-unit 單老師 zip 或 md：週別行位置與 fallback 仍正確', async ({ page }) => {
    await gotoHarness(page);
    const dl = await downloadFrom(page, 'je-export-dual-unit');
    const { filename, buf } = await readDownload(dl);
    if (filename.endsWith('.md')) {
      assertBundle({ [filename]: buf.toString('utf8') }, `dual-unit/single`, { expectMinFiles: 1 });
    } else {
      expect(filename.endsWith('.zip'), `dual-unit 檔案類型：${filename}`).toBe(true);
      const { contents } = await unzipAll(buf);
      const md: Record<string, string> = {};
      for (const [n, c] of Object.entries(contents)) if (n.endsWith('.md')) md[n] = c;
      assertBundle(md, `dual-unit/zip`, { expectMinFiles: 1 });
    }
  });

  test('連續匯出全部 zip 情境 → 匯總所有檔案跨批次不得互相污染', async ({ page }) => {
    await gotoHarness(page);

    // 依序觸發每個 zip 匯出，收集所有下載
    const allBundles: { batch: string; contents: Record<string, string> }[] = [];
    for (const btn of ALL_BUTTONS) {
      const dl = await downloadFrom(page, btn);
      const { filename, buf } = await readDownload(dl);
      if (filename.endsWith('.zip')) {
        const { contents } = await unzipAll(buf);
        const md: Record<string, string> = {};
        for (const [n, c] of Object.entries(contents)) if (n.endsWith('.md')) md[n] = c;
        allBundles.push({ batch: btn, contents: md });
      } else if (filename.endsWith('.md')) {
        allBundles.push({ batch: btn, contents: { [filename]: buf.toString('utf8') } });
      } else {
        throw new Error(`[${btn}] 未預期檔案類型：${filename}`);
      }
    }

    // 每批內部先各自過斷言
    for (const b of allBundles) {
      assertBundle(b.contents, `batch/${b.batch}`, { expectMinFiles: 1 });
    }

    // 跨批污染檢查：任一批的檔案 A 不得包含「其它批」的獨特 slug/name
    const allFiles: { batch: string; file: string; content: string; name: string | null; slug: string | null }[] = [];
    for (const b of allBundles) {
      for (const [file, content] of Object.entries(b.contents)) {
        const p = parseFile(content);
        allFiles.push({ batch: b.batch, file, content, name: p.name, slug: p.slug });
      }
    }
    for (const self of allFiles) {
      for (const other of allFiles) {
        if (other.batch === self.batch) continue; // 同批不做跨檔檢查（已在 assertBundle 覆蓋）
        if (other.slug && other.slug !== self.slug) {
          const occ = countOccurrences(self.content, other.slug);
          expect(
            occ,
            `[cross-batch] ${self.batch}/${self.file} 不得包含 ${other.batch}/${other.file} 的 slug「${other.slug}」`
          ).toBe(0);
        }
        if (other.name && other.name !== '(未命名)' && other.name !== self.name) {
          const occ = countOccurrences(self.content, other.name);
          expect(
            occ,
            `[cross-batch] ${self.batch}/${self.file} 不得包含 ${other.batch}/${other.file} 的 name「${other.name}」`
          ).toBe(0);
        }
      }
    }
  });

  test('連續匯出過程無 console/page error', async ({ page }) => {
    const errors: string[] = [];
    const isNoise = (text: string) =>
      /traffic-ingest/.test(text) ||
      /CORS policy/.test(text) ||
      /Failed to load resource/.test(text) ||
      /net::ERR_FAILED/.test(text) ||
      /analytics|telemetry/i.test(text);
    page.on('pageerror', (e) => {
      if (!isNoise(e.message)) errors.push(`pageerror: ${e.message}`);
    });
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const text = m.text();
      if (isNoise(text)) return;
      errors.push(`console: ${text}`);
    });
    await gotoHarness(page);
    for (const btn of ALL_BUTTONS) {
      await readDownload(await downloadFrom(page, btn));
    }
    expect(errors, `不得產生錯誤：\n${errors.join('\n')}`).toEqual([]);
  });
});
