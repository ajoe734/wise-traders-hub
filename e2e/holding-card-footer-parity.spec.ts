import { test, expect, Locator } from '@playwright/test';
import { gotoHarness, HarnessFixture } from './helpers/holdingCardHarness';

/**
 * Footer 文字合約回歸：srcTitle / srcBadge / errBadge / valueStr / tgtStr / todayCell
 * 涵蓋所有 SRC_LABEL key、priceError、hasToday、valueStr 邊界、tgt 顯示條件。
 */

const SRC_LABEL: Record<string, string> = {
  screenshot: '截圖',
  live: '即時',
  high: '最高',
  ask: '賣一',
  yclose: '昨收',
  demo: 'DEMO',
  regularMarketPrice: '收盤',
  previousClose: '昨收',
  chartClose: '已收K',
  twse: 'TWSE',
  yahoo: 'Yahoo',
};

function badges(page) {
  return {
    src: page.locator('.wb-bottom [role="img"]').first(),
    all: page.locator('.wb-bottom [role="img"]'),
    todayCell: page.locator('.wb-bottom > span.wb-bottom-val').nth(0),
    valueCell: page.locator('.wb-bottom > span.wb-bottom-val').nth(1),
  };
}

const baseH = { cost: 100, price: 110, value: 12345 };

test.describe.parallel('Footer srcLabel / srcTitle', () => {
  for (const [key, label] of Object.entries(SRC_LABEL)) {
    test(`priceSource=${key} → badge 文字 "${label}"、title 含來源`, async ({ page }) => {
      await gotoHarness(page, { h: { ...baseH, priceSource: key }, hasToday: false });
      const { src } = badges(page);
      await expect(src).toHaveText(label);
      const title = await src.getAttribute('title');
      expect(title).toContain(`來源：${label}（${key}）`);
      const aria = await src.getAttribute('aria-label');
      expect(aria).toBe(`報價來源：${title}`);
    });
  }

  test('priceSource=未知字串 mystery → 顯示原字串', async ({ page }) => {
    await gotoHarness(page, { h: { ...baseH, priceSource: 'mystery' }, hasToday: false });
    const { src } = badges(page);
    await expect(src).toHaveText('mystery');
    await expect(src).toHaveAttribute('title', /^來源：mystery（mystery）/);
  });

  test('priceSource=null 且無 priceError → 無任何 badge', async ({ page }) => {
    await gotoHarness(page, { h: { ...baseH }, hasToday: false });
    await expect(badges(page).all).toHaveCount(0);
  });

  test('srcTitle 含 priceUpdatedAt HH:MM', async ({ page }) => {
    await gotoHarness(page, {
      h: { ...baseH, priceSource: 'live', priceUpdatedAt: '2026-07-15T04:30:00Z' },
      hasToday: false,
    });
    const title = await badges(page).src.getAttribute('title');
    expect(title).toMatch(/更新於 (上午|下午)?\d{1,2}:\d{2}/);
  });

  test('srcTitle 含 yesterday（保留 2 位小數）', async ({ page }) => {
    await gotoHarness(page, { h: { ...baseH, priceSource: 'live', yesterday: 105.5 }, hasToday: false });
    const title = await badges(page).src.getAttribute('title');
    expect(title).toContain('昨收 105.50');
  });

  test('srcTitle 含 price（保留 2 位小數）', async ({ page }) => {
    await gotoHarness(page, { h: { ...baseH, price: 110.123, priceSource: 'live' }, hasToday: false });
    const title = await badges(page).src.getAttribute('title');
    expect(title).toContain('現價 110.12');
  });

  test('srcTitle 僅 srcLabel（無 updatedAt/yesterday/price）', async ({ page }) => {
    await gotoHarness(page, { h: { priceSource: 'live' }, hasToday: false });
    const title = await badges(page).src.getAttribute('title');
    expect(title).toBe('來源：即時（live）');
  });

  test('srcTitle 無 srcLabel、無 priceError → 無 badge（fallback 字串僅存在於 memo 內部）', async ({ page }) => {
    await gotoHarness(page, { h: { ...baseH }, hasToday: false });
    await expect(badges(page).all).toHaveCount(0);
  });
});

test.describe.parallel('Footer errBadge', () => {
  test('priceError 且無 priceSource → errBadge 顯示「失敗」', async ({ page }) => {
    await gotoHarness(page, { h: { ...baseH, priceError: 'NET' }, hasToday: false });
    const { all } = badges(page);
    await expect(all).toHaveCount(1);
    const err = all.first();
    await expect(err).toHaveText('失敗');
    await expect(err).toHaveAttribute('title', 'NET');
    await expect(err).toHaveAttribute('aria-label', '報價錯誤：NET');
  });

  test('priceError 且有 priceSource → 顯示 srcBadge、其 title 起首=報價問題', async ({ page }) => {
    await gotoHarness(page, {
      h: { ...baseH, priceSource: 'live', priceError: 'X' },
      hasToday: false,
    });
    const { all, src } = badges(page);
    await expect(all).toHaveCount(1);
    await expect(src).toHaveText('即時');
    const title = await src.getAttribute('title');
    expect(title!.startsWith('報價問題：X')).toBe(true);
  });
});

test.describe.parallel('Footer valueStr', () => {
  test('value=null → "—" + aria-label=無資料', async ({ page }) => {
    await gotoHarness(page, { h: { cost: 1, price: 1, value: null }, hasToday: false });
    const { valueCell } = badges(page);
    await expect(valueCell).toHaveText('—');
    await expect(valueCell).toHaveAttribute('aria-label', '無資料');
  });

  test('value=undefined → "—"', async ({ page }) => {
    await gotoHarness(page, { h: { cost: 1, price: 1 }, hasToday: false });
    const { valueCell } = badges(page);
    await expect(valueCell).toHaveText('—');
  });

  test('value=0 → "0"（無 aria-label）', async ({ page }) => {
    await gotoHarness(page, { h: { cost: 1, price: 1, value: 0 }, hasToday: false });
    const { valueCell } = badges(page);
    // 0.toLocaleString() 是 "0"，valueMissing 判斷是 `|| '—'` → 0 為 falsy 會被視為 missing
    // 元件實作：`h.value?.toLocaleString() || '—'` → 0.toLocaleString()="0" truthy，但 optional chaining OK
    await expect(valueCell).toHaveText('0');
    expect(await valueCell.getAttribute('aria-label')).toBeNull();
  });

  test('value=1500000.5 → toLocaleString', async ({ page }) => {
    await gotoHarness(page, { h: { cost: 1, price: 1, value: 1500000.5 }, hasToday: false });
    const expected = (1500000.5).toLocaleString('en-US'); // Playwright chromium default en-US
    const { valueCell } = badges(page);
    const txt = await valueCell.textContent();
    // 允許 locale 差異（結尾可能有 tgtStr，但這裡 variant=normal 不會有）
    expect(txt).toMatch(/^1[,.\s]?500[,.\s]?000([.,]5)?$/);
    expect(expected).toBeTruthy();
  });
});

test.describe.parallel('Footer tgtStr', () => {
  const inkBase: HarnessFixture = {
    h: { cost: 100, price: 110, value: 100 },
    variant: 'ink',
    hasToday: false,
  };

  test('ink + tp + upside=15.267 → "TGT +15.3%"', async ({ page }) => {
    await gotoHarness(page, { ...inkBase, tp: 200, upside: 15.267 });
    const tgt = badges(page).valueCell.locator('span').last();
    await expect(tgt).toHaveText('TGT +15.3%');
  });
  test('ink + tp + upside=-0.05 → "TGT -0.1%"', async ({ page }) => {
    await gotoHarness(page, { ...inkBase, tp: 200, upside: -0.05 });
    const tgt = badges(page).valueCell.locator('span').last();
    await expect(tgt).toHaveText('TGT -0.1%');
  });
  test('ink + tp + upside=0 → "TGT +0.0%"', async ({ page }) => {
    await gotoHarness(page, { ...inkBase, tp: 200, upside: 0 });
    const tgt = badges(page).valueCell.locator('span').last();
    await expect(tgt).toHaveText('TGT +0.0%');
  });
  test('variant=normal → 不顯示 tgt', async ({ page }) => {
    await gotoHarness(page, { h: { cost: 1, price: 1, value: 100 }, tp: 200, upside: 15, hasToday: false });
    await expect(badges(page).valueCell.locator('span')).toHaveCount(0);
  });
  test('ink + tp=null → 不顯示 tgt', async ({ page }) => {
    await gotoHarness(page, { ...inkBase, tp: null, upside: 15 });
    await expect(badges(page).valueCell.locator('span')).toHaveCount(0);
  });
  test('ink + upside=null → 不顯示 tgt', async ({ page }) => {
    await gotoHarness(page, { ...inkBase, tp: 200, upside: null });
    await expect(badges(page).valueCell.locator('span')).toHaveCount(0);
  });
});

test.describe.parallel('Footer todayCell', () => {
  test('hasToday=false → "—" + aria-label=無資料', async ({ page }) => {
    await gotoHarness(page, { h: baseH, hasToday: false });
    const cell = badges(page).todayCell;
    await expect(cell).toHaveText('—');
    // aria-label 掛在內部 span
    await expect(cell.locator('span')).toHaveAttribute('aria-label', '無資料');
  });
  test('正 pnl + 正 pct', async ({ page }) => {
    await gotoHarness(page, { h: baseH, hasToday: true, todayPnlNum: 1234, todayPctNum: 2.567 });
    await expect(badges(page).todayCell).toHaveText('+1,234+2.57%');
  });
  test('負 pnl + 負 pct', async ({ page }) => {
    await gotoHarness(page, { h: baseH, hasToday: true, todayPnlNum: -1234, todayPctNum: -2.567 });
    await expect(badges(page).todayCell).toHaveText('-1,234-2.57%');
  });
  test('零值', async ({ page }) => {
    await gotoHarness(page, { h: baseH, hasToday: true, todayPnlNum: 0, todayPctNum: 0 });
    await expect(badges(page).todayCell).toHaveText('+0+0.00%');
  });
  test('pnl=null / pct 有值', async ({ page }) => {
    await gotoHarness(page, { h: baseH, hasToday: true, todayPnlNum: null, todayPctNum: 5 });
    await expect(badges(page).todayCell).toHaveText('—+5.00%');
  });
  test('pnl 有值 / pct=null', async ({ page }) => {
    await gotoHarness(page, { h: baseH, hasToday: true, todayPnlNum: 100, todayPctNum: null });
    await expect(badges(page).todayCell).toHaveText('+100');
  });
});
