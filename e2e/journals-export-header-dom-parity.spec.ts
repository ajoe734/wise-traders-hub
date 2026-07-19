import { test, expect, type Page } from '@playwright/test';

/**
 * DOM ↔ text 一致性回歸：確認每份 fixture 的 header 區塊（L0..L8：H1 → 週別 →
 * Slug → 資產類別 → 幣別 → 則數 → 空行 → 分隔線）在畫面上逐行渲染的內容，與
 * `buildMentorMarkdown` 產出的 Markdown 前 9 行完全一致；並額外附上元素截圖
 * 作為視覺回歸快照，防止 fallback 規則造成 header 錯位或字面污染。
 */

const HARNESS_URL = '/e2e/journals-export-header-dom';
const RANGE = { start: '2026-07-13', end: '2026-07-19' };

type Expect = {
  h1: string;      // 完整 L0，例如 `# 老周 週記`
  slug: string;    // Slug 反引號內字面
  asset: string;   // 資產類別行值
  currency: string;// 幣別行值
  count: number;   // 則數
};

const CASES: Array<{ key: string; label: string; exp: Expect }> = [
  { key: 'complete',       label: '完整',           exp: { h1: '# 老周 週記',        slug: 'master-zhou',     asset: '台股', currency: 'TWD', count: 1 } },
  { key: 'missing-fields', label: '三缺',           exp: { h1: '# 缺欄位老師 週記',  slug: 'expert-e',        asset: '-',    currency: '-',   count: 2 } },
  { key: 'no-experts',     label: 'experts=null',  exp: { h1: '# (未命名) 週記',    slug: 'expert-f',        asset: '-',    currency: '-',   count: 1 } },
  { key: 'only-asset',     label: '只缺 asset',     exp: { h1: '# 缺資產老師 週記',  slug: 'missing-asset',   asset: '-',    currency: 'TWD', count: 1 } },
  { key: 'only-currency',  label: '只缺 currency',  exp: { h1: '# 缺幣別老師 週記',  slug: 'missing-currency',asset: '美股', currency: '-',   count: 1 } },
  { key: 'only-slug',      label: '只缺 slug',      exp: { h1: '# 缺 Slug 老師 週記',slug: 'expert-ms',       asset: '台股', currency: 'TWD', count: 1 } },
];

async function goto(page: Page) {
  await page.goto(HARNESS_URL);
  await expect(page.getByTestId('jehd-status')).toHaveText(`ready:${CASES.length}`);
}

// 讀取單一 fixture 的 DOM 每行文字
async function readDomLines(page: Page, key: string): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < 9; i++) {
    const raw = await page.getByTestId(`jehd-line-${key}-${i}`).textContent();
    // 空行以 \u00A0 佔位以維持 line-box 高度；比對前還原成空字串
    out.push((raw ?? '').replace(/\u00A0/g, ''));
  }
  return out;
}

async function readSourceHeader(page: Page, key: string): Promise<string[]> {
  const md = await page.getByTestId(`jehd-md-${key}`).getAttribute('data-md');
  expect(md, `data-md 應存在：${key}`).toBeTruthy();
  return md!.split('\n').slice(0, 9);
}

test.describe('Journals export — header DOM/text 一致性與視覺快照', () => {
  for (const c of CASES) {
    test(`[${c.key}] ${c.label}：DOM 每行 = markdown 前 9 行，且符合期望字面`, async ({ page }) => {
      await goto(page);

      const dom = await readDomLines(page, c.key);
      const src = await readSourceHeader(page, c.key);

      // 1) DOM ↔ text parity：逐行完全一致
      expect(dom.length, 'DOM 行數應為 9').toBe(9);
      expect(src.length, 'source 應至少 9 行').toBe(9);
      for (let i = 0; i < 9; i++) {
        expect(dom[i], `L${i} DOM 與 markdown 不一致（key=${c.key}）`).toBe(src[i]);
      }

      // 2) 期望字面（fallback 契約）
      expect(dom[0], `L0 H1`).toBe(c.exp.h1);
      expect(dom[1], `L1 空行`).toBe('');
      expect(dom[2], `L2 週別`).toBe(`- 週別：${RANGE.start} ~ ${RANGE.end}`);
      expect(dom[3], `L3 Slug`).toBe(`- Slug：\`${c.exp.slug}\``);
      expect(dom[4], `L4 資產類別`).toBe(`- 資產類別：${c.exp.asset}`);
      expect(dom[5], `L5 幣別`).toBe(`- 幣別：${c.exp.currency}`);
      expect(dom[6], `L6 則數`).toBe(`- 則數：${c.exp.count}`);
      expect(dom[7], `L7 空行`).toBe('');
      expect(dom[8], `L8 分隔線`).toBe('---');

      // 3) 反向：禁止字面（fallback 未套用會露餡）
      const joined = dom.join('\n');
      for (const forbidden of ['null', 'undefined', 'NaN', '(NULL)']) {
        expect(joined.includes(forbidden), `header 不得出現「${forbidden}」`).toBe(false);
      }
      expect(/^# \s*週記$/.test(dom[0]), 'H1 不得為空 name').toBe(false);
      expect(dom[3] === '- Slug：``', 'Slug 反引號內不得為空').toBe(false);
      expect(dom[4].endsWith('：'), '資產類別行不得以冒號結尾').toBe(false);
      expect(dom[5].endsWith('：'), '幣別行不得以冒號結尾').toBe(false);

      // 4) （可選）視覺快照：以元素截圖為單位，失敗時附加至 report
      const shot = await page.getByTestId(`jehd-header-${c.key}`).screenshot();
      await test.info().attach(`header-${c.key}.png`, {
        body: shot,
        contentType: 'image/png',
      });
    });
  }

  test('跨 fixture 不互相污染：每個 header 只包含自己的 slug/name', async ({ page }) => {
    await goto(page);
    const allDom: Record<string, string> = {};
    for (const c of CASES) {
      allDom[c.key] = (await readDomLines(page, c.key)).join('\n');
    }
    for (const c of CASES) {
      for (const other of CASES) {
        if (other.key === c.key) continue;
        // slug 極少會撞（本測試 fixture 皆唯一），任一其他 fixture slug 不得出現於此 header
        // 排除 '-' 這種 fallback 值，也排除彼此可能重疊的通用字（asset/currency）
        if (other.exp.slug === '-' || c.exp.slug === '-') continue;
        expect(
          allDom[c.key].includes(other.exp.slug),
          `[${c.key}] header 不得出現其他 fixture 的 slug「${other.exp.slug}」`,
        ).toBe(false);
      }
    }
  });

  test('無 console/page error（header DOM 渲染不得炸掉）', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const t = m.text();
      // 略過 analytics / traffic-ingest / CORS 等與本測試無關的環境雜訊
      if (/traffic-ingest|CORS|Failed to load resource|net::ERR_/i.test(t)) return;
      errors.push(`console: ${t}`);
    });
    await goto(page);
    for (const c of CASES) {
      await expect(page.getByTestId(`jehd-block-${c.key}`)).toBeVisible();
    }
    expect(errors, `不得產生錯誤：\n${errors.join('\n')}`).toEqual([]);
  });
});
