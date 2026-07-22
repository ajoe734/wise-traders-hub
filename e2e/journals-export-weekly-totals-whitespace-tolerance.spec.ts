import { test, expect } from '@playwright/test';

const HARNESS_URL = '/e2e/journals-export-harness';

/**
 * Regression: 「本週總計」的擷取邏輯必須容忍常見的空白 / 換行差異
 * （CRLF、CR-only、額外空白行、行尾 trailing spaces、bullet 前多空白、
 * 全形/半形冒號、標題與 bullet 之間插入空白列）。
 *
 * 新格式（P0-6）：
 *   單一單位：`- 進場側合計 (buy + add)（買進 N 筆）：X 單位`
 *   多單位  ：`- 進場側合計 (buy + add)（買進 N 筆）（依單位分列，未換算）：`
 *              `  - X 單位`
 *              `  - Y 單位`
 *   無資料  ：`- 進場側合計 (buy + add)：無`
 */

async function downloadMd(page: import('@playwright/test').Page, buttonTestId: string) {
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId(buttonTestId).click(),
  ]);
  const p = await dl.path();
  expect(p, `download for ${buttonTestId} must resolve to a path`).toBeTruthy();
  const fs = await import('node:fs/promises');
  return fs.readFile(p!, 'utf8');
}

function mutations(baseline: string): { name: string; text: string }[] {
  const lf = baseline.replace(/\r\n?/g, '\n');
  return [
    { name: 'baseline (原樣)', text: baseline },
    { name: 'CRLF line endings', text: lf.replace(/\n/g, '\r\n') },
    { name: 'CR-only line endings (舊 Mac)', text: lf.replace(/\n/g, '\r') },
    {
      name: '「## 本週總計」與首個 bullet 之間插入多個空白列',
      text: lf.replace('## 本週總計\n', '## 本週總計\n\n\n\n'),
    },
    {
      name: '每個 bullet 後加 trailing spaces',
      text: lf
        .split('\n')
        .map((line) => (/^\s*-\s/.test(line) ? line + '   ' : line))
        .join('\n'),
    },
    {
      name: '在「：」前後插入空白',
      text: lf.replace(/：/g, ' ： '),
    },
    {
      name: '在檔案尾端補上多餘空白列 + BOM',
      text: '\uFEFF' + lf + '\n\n\n   \n',
    },
  ];
}

type Totals =
  | { kind: 'single'; buy: string; sell: string }
  | { kind: 'split'; buy: string[]; sell: string[] };

// 寬容 parser：只針對「進場側合計 / 出場側合計」兩行
const ENTRY_LABEL = '進場側合計 \\(buy \\+ add\\)';
const EXIT_LABEL = '出場側合計 \\(sell \\+ trim \\+ exit\\)';

function parseTolerant(md: string): Totals {
  const norm = md.replace(/\r\n?/g, '\n');
  const idx = norm.search(/^\s*##\s*本週總計\s*$/m);
  expect(idx, '寬容 parser 也必須能找到「## 本週總計」').toBeGreaterThan(-1);
  const tail = norm.slice(idx);

  const readSection = (labelRe: string): { mode: 'single'; value: string } | { mode: 'split'; value: string[] } => {
    // 單行：- <label>（optional 括號註）：X 單位
    // 括號註可能含全形空白，所以我們用 [^：\n]*? 抓
    const single = new RegExp(
      `^[ \\t]*[-*][ \\t]+${labelRe}(?:[（(][^：\\n]*?[)）])?[ \\t]*[：:][ \\t]*(?!$)(?![ \\t]*$)(\\S.*?)[ \\t]*$`,
      'm',
    );
    const m1 = tail.match(single);
    if (m1 && !/依單位分列/.test(m1[0])) return { mode: 'single' as const, value: m1[1].trim() };

    // 分列 header：以 `（依單位分列，未換算）：` 結尾
    const header = new RegExp(
      `^[ \\t]*[-*][ \\t]+${labelRe}(?:[（(][^：\\n]*?[)）])?（依單位分列，未換算）[ \\t]*[：:][ \\t]*$`,
      'm',
    );
    const hm = tail.match(header);
    expect(hm, `${labelRe} 必須是單行或分列格式其一`).toBeTruthy();
    const after = tail.slice(tail.indexOf(hm![0]) + hm![0].length);
    const items: string[] = [];
    const lines = after.split('\n');
    for (const raw of lines) {
      const line = raw.replace(/[ \t]+$/, '');
      if (/^[ \t]+[-*][ \t]+/.test(line)) {
        items.push(line.replace(/^[ \t]+[-*][ \t]+/, '').replace(/[ \t]*[：:][ \t]*/, ' ').trim().replace(/\s+/g, ' '));
      } else if (line.trim() === '') {
        continue;
      } else {
        break;
      }
    }
    return { mode: 'split' as const, value: items };
  };

  const buy = readSection(ENTRY_LABEL);
  const sell = readSection(EXIT_LABEL);
  if (buy.mode === 'single' && sell.mode === 'single') {
    return { kind: 'single', buy: buy.value, sell: sell.value };
  }
  return {
    kind: 'split',
    buy: buy.mode === 'split' ? buy.value : [buy.value],
    sell: sell.mode === 'split' ? sell.value : [sell.value],
  };
}

test.describe('Journals export — 本週總計 whitespace / newline tolerance', () => {
  test('單一單位（老周 2 張 / 1 張）在所有 whitespace 變體下解析一致', async ({ page }) => {
    await page.goto(HARNESS_URL);
    await expect(page.getByTestId('je-status')).toHaveText('idle');
    const baseline = await downloadMd(page, 'je-export-single');

    for (const { name, text } of mutations(baseline)) {
      const totals = parseTolerant(text);
      expect(totals.kind, `[${name}] 應為單行格式`).toBe('single');
      if (totals.kind !== 'single') continue;
      expect(totals.buy, `[${name}] buy`).toBe('2 張');
      expect(totals.sell, `[${name}] sell`).toBe('1 張');
    }
  });

  test('預設「張」回退（tw_stock 助教小陳 10 / 14 張）在所有 whitespace 變體下解析一致', async ({ page }) => {
    await page.goto(HARNESS_URL);
    const baseline = await downloadMd(page, 'je-export-empty-unit');

    for (const { name, text } of mutations(baseline)) {
      const totals = parseTolerant(text);
      expect(totals.kind, `[${name}] 應為單行格式`).toBe('single');
      if (totals.kind !== 'single') continue;
      expect(totals.buy, `[${name}] buy`).toBe('10 張');
      expect(totals.sell, `[${name}] sell`).toBe('14 張');
    }
  });

  test('雙單位分列（張 + 股）在所有 whitespace 變體下仍能列出每個單位', async ({ page }) => {
    await page.goto(HARNESS_URL);
    const baseline = await downloadMd(page, 'je-export-dual-unit');

    const base = parseTolerant(baseline);
    expect(base.kind).toBe('split');

    for (const { name, text } of mutations(baseline)) {
      const totals = parseTolerant(text);
      expect(totals.kind, `[${name}] 應為分列格式`).toBe('split');
      if (totals.kind !== 'split') continue;
      // fixture: buy 2 張 + 500 股；sell 1 張 + 300 股
      expect(totals.buy.sort(), `[${name}] buy`).toEqual(['2 張', '500 股'].sort());
      expect(totals.sell.sort(), `[${name}] sell`).toEqual(['1 張', '300 股'].sort());
    }
  });
});
