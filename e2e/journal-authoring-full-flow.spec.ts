/**
 * E2E 回歸 — 週記撰寫：完整流程 4 assetClass × 4 action 矩陣
 *
 * Protects the single-source-of-truth pipeline:
 *   sanitizeAssetQuantityUnit → getAssetSpec → notional → capital / oversell
 *
 * 資產類別：tw_stock / us_stock / crypto / us_future
 * 動作：buy / add / sell / exit
 *
 * 每一格斷言：
 *  - 單位被 sanitize 到 assetClass 允許清單（美股永遠 '股'，加密永遠 '顆'，期貨永遠 '口'）
 *  - notional 使用正確乘數（張 → ×1000，其餘 ×1）
 *  - 無虛假 capital-exceeded 或 oversell 誤觸發
 *  - 目標價欄位可空
 */
import { test, expect } from '@playwright/test';

type AC = 'tw_stock' | 'us_stock' | 'crypto' | 'us_future';
type Action = 'buy' | 'add' | 'sell' | 'exit';

const MATRIX: {
  ac: AC;
  sym: string;
  expectedUnit: '張' | '股' | '顆' | '口';
  expectedCurrency: 'TWD' | 'USD';
  price: number;
  qty: number;
  // notional multiplier for the resolved unit
  mult: number;
}[] = [
  { ac: 'tw_stock', sym: '2330', expectedUnit: '張', expectedCurrency: 'TWD', price: 600, qty: 2, mult: 1000 },
  { ac: 'us_stock', sym: 'AAPL', expectedUnit: '股', expectedCurrency: 'USD', price: 200, qty: 10, mult: 1 },
  { ac: 'crypto', sym: 'BTC', expectedUnit: '顆', expectedCurrency: 'USD', price: 60000, qty: 1, mult: 1 },
  { ac: 'us_future', sym: '/ES', expectedUnit: '口', expectedCurrency: 'USD', price: 5000, qty: 1, mult: 1 },
];

const ACTIONS: Action[] = ['buy', 'add', 'sell', 'exit'];

// 亂填單位測試 sanitizer 一定會落回該資產類別的合法單位
const WRONG_UNIT_BY_AC: Record<AC, string> = {
  tw_stock: '顆',
  us_stock: '張', // 常見 bug：美股寫回「張」導致 1000× 錯誤
  crypto: '張',
  us_future: '股',
};

for (const cell of MATRIX) {
  for (const action of ACTIONS) {
    test(`${cell.ac} · ${action} · sanitizer + notional 單一資料源`, async ({ page }) => {
      const invQty = action === 'sell' || action === 'exit' ? cell.qty * 10 : 0;
      const url =
        `/e2e/journal-authoring-harness?ac=${cell.ac}` +
        `&action=${action}` +
        `&sym=${encodeURIComponent(cell.sym)}` +
        `&qty=${cell.qty}` +
        `&price=${cell.price}` +
        `&capital=100000000` +
        `&invQty=${invQty}` +
        `&invUnit=${encodeURIComponent(cell.expectedUnit)}` +
        `&userUnit=${encodeURIComponent(WRONG_UNIT_BY_AC[cell.ac])}`;

      await page.goto(url, { waitUntil: 'domcontentloaded' });

      await expect(page.getByTestId('asset-class')).toHaveText(cell.ac);
      await expect(page.getByTestId('action')).toHaveText(action);
      await expect(page.getByTestId('symbol-valid')).toHaveText('true');

      // 憲法：resolvedUnit 必為該 asset class 的合法單位
      await expect(page.getByTestId('resolved-unit')).toHaveText(cell.expectedUnit);
      await expect(page.getByTestId('currency')).toHaveText(cell.expectedCurrency);

      // notional = qty × price × mult
      const expectedNotional = cell.qty * cell.price * cell.mult;
      await expect(page.getByTestId('notional')).toHaveText(String(expectedNotional));

      // 100M 資金下不應觸發 capital-exceeded
      await expect(page.getByTestId('capital-exceeded')).toHaveText('false');

      // sell / exit：inventory 遠大於賣量 → 不應 oversell
      // buy / add：oversell 恆為 false
      await expect(page.getByTestId('oversell')).toHaveText('false');
      await expect(page.getByTestId('unit-conflict')).toHaveText('false');
      await expect(page.getByTestId('can-publish')).toHaveText('true');
      await expect(page.getByTestId('block-reason')).toHaveText('none');
    });
  }
}

test('美股寫回 "張" 必被 sanitizer 校正為 "股"（1000× bug 憲法）', async ({ page }) => {
  await page.goto('/e2e/journal-authoring-harness?ac=us_stock&action=buy&sym=AAPL&qty=10&price=200&userUnit=張');
  await expect(page.getByTestId('resolved-unit')).toHaveText('股');
  // 若 sanitizer 失效，notional = 10 × 200 × 1000 = 2,000,000（錯誤）
  // 正確：10 × 200 × 1 = 2000
  await expect(page.getByTestId('notional')).toHaveText('2000');
});

test('美股期貨符號 /ES 必被視為合法且單位鎖定「口」', async ({ page }) => {
  await page.goto('/e2e/journal-authoring-harness?ac=us_future&action=buy&sym=%2FES&qty=1&price=5000&userUnit=股');
  await expect(page.getByTestId('symbol-valid')).toHaveText('true');
  await expect(page.getByTestId('resolved-unit')).toHaveText('口');
});
