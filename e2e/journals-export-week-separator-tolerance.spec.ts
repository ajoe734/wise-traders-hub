import { test, expect } from '@playwright/test';

/**
 * Regression: 週別行的日期分隔符必須被寬容 parser 正確解析成同一組
 * (startLabel, endLabel)，且對「## 本週總計」區段的解析結果毫無影響。
 *
 * 覆蓋的分隔符 / 標點變體（只變異週別行，其他區段保持原樣）：
 *   1) baseline  '~'                       - 產出實際使用的半形波浪
 *   2) '〜'      (U+301C WAVE DASH)
 *   3) '～'      (U+FF5E FULLWIDTH TILDE)
 *   4) '—'      (U+2014 EM DASH)
 *   5) '–'      (U+2013 EN DASH)
 *   6) '-'      (半形連字號)
 *   7) 'to'     (英文文字分隔)
 *   8) '至'     (中文文字分隔)
 *   9) '~~'     (雙波浪，常見人為錯字)
 *  10) '  ~  '  (前後多空白)
 *  11) 全形冒號改半形 + '~' + 兩側空白緊縮
 *  12) 週別行前後插入 trailing spaces / BOM
 *
 * 每個變體同時斷言：
 *   A) 寬容 parser 能還原出與 fixture 一致的 (start, end)
 *   B) 「## 本週總計」的解析結果與 baseline 完全一致（不受週別分隔符影響）
 */

const HARNESS_URL = '/e2e/journals-export-harness';

async function downloadMd(page: import('@playwright/test').Page, testId: string) {
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId(testId).click(),
  ]);
  const p = await dl.path();
  expect(p, `download for ${testId}`).toBeTruthy();
  const fs = await import('node:fs/promises');
  return fs.readFile(p!, 'utf8');
}

// ---------- 寬容週別 parser ----------
/**
 * 支援：
 *  - 全形/半形冒號
 *  - 分隔符：~ 〜 ～ — – - 、雙波浪 ~~、以及 "to" / "至"（前後允許空白）
 *  - 行首/行尾任意空白、bullet 前後任意空白
 *  - CRLF / CR / LF
 */
const WEEK_LINE_RE =
  /^[ \t]*[-*][ \t]+週別[ \t]*[：:][ \t]*(\d{4}-\d{2}-\d{2})[ \t]*(?:~~|~|〜|～|—|–|-|to|至)[ \t]*(\d{4}-\d{2}-\d{2})[ \t]*$/m;

function parseWeek(md: string): { start: string; end: string } {
  const norm = md.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
  const m = norm.match(WEEK_LINE_RE);
  expect(m, '寬容 parser 必須找到週別行').toBeTruthy();
  return { start: m![1], end: m![2] };
}

// ---------- 沿用 totals parser（與 whitespace tolerance 測試同一份契約） ----------
type Totals =
  | { kind: 'single'; buy: string; sell: string }
  | { kind: 'split'; buy: Record<string, string>; sell: Record<string, string> };

function parseTotals(md: string): Totals {
  const norm = md.replace(/\r\n?/g, '\n');
  const idx = norm.search(/^\s*##\s*本週總計\s*$/m);
  expect(idx, '必須找到「## 本週總計」').toBeGreaterThan(-1);
  const tail = norm.slice(idx);

  const readSection = (label: '總買進股數' | '總賣出股數') => {
    const single = new RegExp(
      `^[ \\t]*[-*][ \\t]+${label}[ \\t]*[：:][ \\t]*(\\S.*?)[ \\t]*$`,
      'm',
    );
    const m1 = tail.match(single);
    if (m1) return { mode: 'single' as const, value: m1[1].trim() };

    const header = new RegExp(
      `^[ \\t]*[-*][ \\t]+${label}（依單位分列）[ \\t]*[：:][ \\t]*$`,
      'm',
    );
    const hm = tail.match(header);
    expect(hm, `${label} 必須是單行或分列其一`).toBeTruthy();
    const after = tail.slice(tail.indexOf(hm![0]) + hm![0].length);
    const map: Record<string, string> = {};
    const childRe = /^[ \t]+[-*][ \t]+(\S+?)[ \t]*[：:][ \t]*(\S.*?)[ \t]*$/gm;
    let cm: RegExpExecArray | null;
    while ((cm = childRe.exec(after))) {
      map[cm[1]] = cm[2].trim();
      const nextNl = after.indexOf('\n', cm.index + cm[0].length);
      if (nextNl === -1) break;
      const peek = after.slice(nextNl + 1);
      if (/^[ \t]*[-*][ \t]+\S/.test(peek) && !/^[ \t]+[-*]/.test(peek)) break;
    }
    return { mode: 'split' as const, value: map };
  };

  const buy = readSection('總買進股數');
  const sell = readSection('總賣出股數');
  if (buy.mode === 'single' && sell.mode === 'single') {
    return { kind: 'single', buy: buy.value, sell: sell.value };
  }
  return {
    kind: 'split',
    buy: buy.mode === 'split' ? buy.value : { _: buy.value },
    sell: sell.mode === 'split' ? sell.value : { _: sell.value },
  };
}

// ---------- 變異工具：只改「- 週別：<start> ~ <end>」這一行 ----------
const ORIG_WEEK_RE = /^[ \t]*-[ \t]*週別：(\d{4}-\d{2}-\d{2})[ \t]*~[ \t]*(\d{4}-\d{2}-\d{2})[ \t]*$/m;

type Mut = { name: string; replace: (start: string, end: string) => string };

const MUTATIONS: Mut[] = [
  { name: 'baseline (~)', replace: (s, e) => `- 週別：${s} ~ ${e}` },
  { name: 'WAVE DASH 〜 (U+301C)', replace: (s, e) => `- 週別：${s} 〜 ${e}` },
  { name: 'FULLWIDTH TILDE ～ (U+FF5E)', replace: (s, e) => `- 週別：${s} ～ ${e}` },
  { name: 'EM DASH —', replace: (s, e) => `- 週別：${s} — ${e}` },
  { name: 'EN DASH –', replace: (s, e) => `- 週別：${s} – ${e}` },
  { name: 'HYPHEN-MINUS -', replace: (s, e) => `- 週別：${s} - ${e}` },
  { name: '英文 "to"', replace: (s, e) => `- 週別：${s} to ${e}` },
  { name: '中文「至」', replace: (s, e) => `- 週別：${s} 至 ${e}` },
  { name: '雙波浪 ~~', replace: (s, e) => `- 週別：${s} ~~ ${e}` },
  { name: '前後多空白 "  ~  "', replace: (s, e) => `- 週別：${s}    ~    ${e}` },
  { name: '半形冒號 + 緊縮空白 (${s}~${e})', replace: (s, e) => `- 週別:${s}~${e}` },
  { name: '週別行加 trailing spaces + BOM', replace: (s, e) => `\uFEFF- 週別：${s} ~ ${e}    ` },
];

function mutateWeekLine(md: string, mut: Mut) {
  const m = md.match(ORIG_WEEK_RE);
  expect(m, 'baseline 必須有原始週別行').toBeTruthy();
  const [s, e] = [m![1], m![2]];
  return { text: md.replace(ORIG_WEEK_RE, mut.replace(s, e)), start: s, end: e };
}

// ---------- Tests ----------
test.describe('Journals export — 週別分隔符變體寬容解析', () => {
  test('single mentor（master-zhou，2 張 / 1 張）— 週別分隔符變體全數解析成一致範圍且不影響 totals', async ({
    page,
  }) => {
    await page.goto(HARNESS_URL);
    await expect(page.getByTestId('je-status')).toHaveText('idle');
    const baseline = await downloadMd(page, 'je-export-single');

    // DEBUG
    // eslint-disable-next-line no-console
    console.log('BASELINE_HEAD:', JSON.stringify(baseline.slice(0, 400)));

    // baseline 的 totals 是 single-unit
    const baseTotals = parseTotals(baseline);
    expect(baseTotals.kind).toBe('single');


    for (const mut of MUTATIONS) {
      const { text, start, end } = mutateWeekLine(baseline, mut);
      // eslint-disable-next-line no-console
      console.log('MUT', mut.name, '->', JSON.stringify(text.slice(0, 120)));
      const wk = parseWeek(text);
      expect(wk.start, `[${mut.name}] start`).toBe(start);
      expect(wk.end, `[${mut.name}] end`).toBe(end);


      // totals 必須與 baseline 完全一致（分隔符變體不能污染總計解析）
      const t = parseTotals(text);
      expect(t, `[${mut.name}] totals 必須維持不變`).toEqual(baseTotals);
    }
  });

  test('empty-unit fallback（assistant-chen，10 / 14 股）— 週別變體不影響「股」回退解析', async ({ page }) => {
    await page.goto(HARNESS_URL);
    const baseline = await downloadMd(page, 'je-export-empty-unit');
    const baseTotals = parseTotals(baseline);
    expect(baseTotals.kind).toBe('single');

    for (const mut of MUTATIONS) {
      const { text, start, end } = mutateWeekLine(baseline, mut);
      const wk = parseWeek(text);
      expect(wk.start).toBe(start);
      expect(wk.end).toBe(end);
      expect(parseTotals(text), `[${mut.name}]`).toEqual(baseTotals);
    }
  });

  test('dual-unit split（dual-unit-master，張+股）— 週別變體下仍能正確分列 totals', async ({ page }) => {
    await page.goto(HARNESS_URL);
    const baseline = await downloadMd(page, 'je-export-dual-unit');
    const baseTotals = parseTotals(baseline);
    expect(baseTotals.kind).toBe('split');

    for (const mut of MUTATIONS) {
      const { text, start, end } = mutateWeekLine(baseline, mut);
      const wk = parseWeek(text);
      expect(wk.start).toBe(start);
      expect(wk.end).toBe(end);
      expect(parseTotals(text), `[${mut.name}]`).toEqual(baseTotals);
    }
  });

  test('custom range（跨月 2026-07-27 ~ 2026-08-02）— 週別變體全數維持起訖不飄移', async ({ page }) => {
    await page.goto(`${HARNESS_URL}?start=2026-07-27&end=2026-08-02`);
    await expect(page.getByTestId('je-status')).toHaveText('idle');
    const baseline = await downloadMd(page, 'je-export-single');

    for (const mut of MUTATIONS) {
      const { text } = mutateWeekLine(baseline, mut);
      const wk = parseWeek(text);
      expect(wk.start, `[${mut.name}] start`).toBe('2026-07-27');
      expect(wk.end, `[${mut.name}] end`).toBe('2026-08-02');
    }
  });
});
