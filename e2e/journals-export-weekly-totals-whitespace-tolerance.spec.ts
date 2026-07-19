import { test, expect } from '@playwright/test';

const HARNESS_URL = '/e2e/journals-export-harness';

/**
 * Regression: 「本週總計」的擷取邏輯必須容忍常見的空白 / 換行差異
 * （CRLF、CR-only、額外空白行、行尾 trailing spaces、bullet 前多空白、
 * 全形/半形冒號、標題與 bullet 之間插入空白列）。
 *
 * 作法：
 *   1) 從 harness 匯出取得「原始」Markdown 作為 baseline。
 *   2) 對其套用多種 whitespace/newline 變體。
 *   3) 用一個寬容 parser（regex 使用 [ \t]*、允許 \r\n\|\r\|\n）解析。
 *   4) 三個場景（單一單位、空/缺 unit 回退、雙單位分列）
 *      的解析結果都必須與 fixture 完全一致。
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

/** 產生一批 whitespace/newline 變體，全都應該解析成同樣結果。 */
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
      name: 'bullet marker 後多加空白（- 變 -   ）',
      text: lf
        .split('\n')
        .map((line) => line.replace(/^(\s*)-\s/, '$1-   '))
        .join('\n'),
    },

    {
      name: '每個 bullet 後加 trailing spaces',
      text: lf
        .split('\n')
        .map((line) => (/^\s*-\s/.test(line) ? line + '   ' : line))
        .join('\n'),
    },
    {
      name: '將半形冒號「:」殘留全部保留、但在「：」前後插入空白',
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
  | { kind: 'split'; buy: Record<string, string>; sell: Record<string, string> };

/**
 * 寬容 parser：
 *   - 支援 \r\n | \r | \n
 *   - 允許 bullet 前後任意 spaces / tabs
 *   - 允許 ：前後插入空白
 *   - 支援單行「- 總買進股數：N 單位」以及分列格式的子項目
 */
function parseTolerant(md: string): Totals {
  const norm = md.replace(/\r\n?/g, '\n');
  const idx = norm.search(/^\s*##\s*本週總計\s*$/m);
  expect(idx, '寬容 parser 也必須能找到「## 本週總計」').toBeGreaterThan(-1);
  const tail = norm.slice(idx);

  const readSection = (label: '總買進股數' | '總賣出股數') => {
    // 單行：- 總買進股數 ： 10 股
    const single = new RegExp(
      `^[ \\t]*[-*][ \\t]+${label}[ \\t]*[：:][ \\t]*(\\S.*?)[ \\t]*$`,
      'm',
    );
    const m1 = tail.match(single);
    if (m1) return { mode: 'single' as const, value: m1[1].trim() };

    // 分列：- 總買進股數（依單位分列）：
    //   - 張 ： 2 張
    //   - 股 ： 500 股
    const header = new RegExp(
      `^[ \\t]*[-*][ \\t]+${label}（依單位分列）[ \\t]*[：:][ \\t]*$`,
      'm',
    );
    const hm = tail.match(header);
    expect(hm, `${label} 必須是單行或分列格式其一`).toBeTruthy();
    const after = tail.slice(tail.indexOf(hm![0]) + hm![0].length);
    const map: Record<string, string> = {};
    const childRe = /^[ \t]+[-*][ \t]+(\S+?)[ \t]*[：:][ \t]*(\S.*?)[ \t]*$/gm;
    let cm: RegExpExecArray | null;
    while ((cm = childRe.exec(after))) {
      // 若碰到下一個非縮排 bullet，代表區段結束
      const lineStart = after.lastIndexOf('\n', cm.index) + 1;
      const leading = after.slice(lineStart, cm.index + cm[0].length - cm[0].trimStart().length);
      if (leading.length === 0) break;
      map[cm[1]] = cm[2].trim();
      // 停在下一個 top-level bullet 之前
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

  test('預設「股」回退（助教小陳 10 / 14 股）在所有 whitespace 變體下解析一致', async ({ page }) => {
    await page.goto(HARNESS_URL);
    const baseline = await downloadMd(page, 'je-export-empty-unit');

    for (const { name, text } of mutations(baseline)) {
      const totals = parseTolerant(text);
      expect(totals.kind, `[${name}] 應為單行格式`).toBe('single');
      if (totals.kind !== 'single') continue;
      expect(totals.buy, `[${name}] buy`).toBe('10 股');
      expect(totals.sell, `[${name}] sell`).toBe('14 股');
    }
  });

  test('雙單位分列（張 + 股）在所有 whitespace 變體下仍能正確配對每個單位', async ({ page }) => {
    await page.goto(HARNESS_URL);
    const baseline = await downloadMd(page, 'je-export-dual-unit');

    // 先確認 baseline 就是分列格式
    const base = parseTolerant(baseline);
    expect(base.kind).toBe('split');

    for (const { name, text } of mutations(baseline)) {
      const totals = parseTolerant(text);
      expect(totals.kind, `[${name}] 應為分列格式`).toBe('split');
      if (totals.kind !== 'split') continue;
      // fixture: buy 2 張 + 500 股；sell 1 張 + 300 股
      expect(totals.buy['張'], `[${name}] buy 張`).toBe('2 張');
      expect(totals.buy['股'], `[${name}] buy 股`).toBe('500 股');
      expect(totals.sell['張'], `[${name}] sell 張`).toBe('1 張');
      expect(totals.sell['股'], `[${name}] sell 股`).toBe('300 股');
    }
  });
});
