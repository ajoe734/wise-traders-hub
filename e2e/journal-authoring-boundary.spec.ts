/**
 * E2E 邊界回歸 — 週記撰寫：
 *  1) 目標價 0：不得被 falsy 吞掉；保留數字 0
 *  2) 股數 0：quantity-invalid=true 且 block-reason=QUANTITY_ZERO
 *  3) 賣超（oversell）：現有庫存 < 賣出量 → block-reason=OVERSELL
 *  4) 資金爆表（capital-exceeded）：notional > capital → block-reason=CAPITAL_EXCEEDED
 *  5) 單位與資產類別不符（美股寫入「張」）→ sanitize + 不出現 UNIT_CONFLICT
 *  6) 賣出時單位與歷史庫存衝突 → block-reason=UNIT_CONFLICT
 */
import { test, expect } from '@playwright/test';

test.describe('週記撰寫 · 邊界回歸', () => {
  test('目標價 0：保留數字 0，不變成 null 或空白', async ({ page }) => {
    await page.goto(
      '/e2e/journal-authoring-harness?ac=us_stock&action=buy&sym=AAPL&qty=10&price=200&target=0',
    );
    await expect(page.getByTestId('target-price-raw')).toHaveText('0');
    await expect(page.getByTestId('target-price')).toHaveText('0');
    // 目標價 0 不影響 can-publish（買入邏輯不依賴 target）
    await expect(page.getByTestId('can-publish')).toHaveText('true');
  });

  test('目標價空字串：正確表示 null（負向對照）', async ({ page }) => {
    await page.goto(
      '/e2e/journal-authoring-harness?ac=us_stock&action=buy&sym=AAPL&qty=10&price=200&target=',
    );
    await expect(page.getByTestId('target-price')).toHaveText('null');
  });

  test('股數 0：quantity-invalid + block-reason=QUANTITY_ZERO', async ({ page }) => {
    await page.goto(
      '/e2e/journal-authoring-harness?ac=us_stock&action=buy&sym=AAPL&qty=0&price=200',
    );
    await expect(page.getByTestId('quantity-invalid')).toHaveText('true');
    await expect(page.getByTestId('can-publish')).toHaveText('false');
    await expect(page.getByTestId('block-reason')).toHaveText('QUANTITY_ZERO');
  });

  test('賣超（sell）：現有庫存 5，賣 10 → OVERSELL', async ({ page }) => {
    await page.goto(
      '/e2e/journal-authoring-harness?ac=us_stock&action=sell&sym=AAPL&qty=10&price=200&invQty=5&invUnit=%E8%82%A1&userUnit=%E8%82%A1',
    );
    await expect(page.getByTestId('oversell')).toHaveText('true');
    await expect(page.getByTestId('can-publish')).toHaveText('false');
    await expect(page.getByTestId('block-reason')).toHaveText('OVERSELL');
  });

  test('賣超（exit）：現有庫存 0 → OVERSELL 即使 exit 也擋', async ({ page }) => {
    await page.goto(
      '/e2e/journal-authoring-harness?ac=tw_stock&action=exit&sym=2330&qty=1&price=600&invQty=0&invUnit=%E5%BC%B5&userUnit=%E5%BC%B5',
    );
    await expect(page.getByTestId('oversell')).toHaveText('true');
    await expect(page.getByTestId('block-reason')).toHaveText('OVERSELL');
  });

  test('資金爆表：台股 2 張 × 600 × 1000 = 1.2M，但資金只有 500k → CAPITAL_EXCEEDED', async ({ page }) => {
    await page.goto(
      '/e2e/journal-authoring-harness?ac=tw_stock&action=buy&sym=2330&qty=2&price=600&capital=500000&userUnit=%E5%BC%B5',
    );
    await expect(page.getByTestId('notional')).toHaveText('1200000');
    await expect(page.getByTestId('capital-exceeded')).toHaveText('true');
    await expect(page.getByTestId('can-publish')).toHaveText('false');
    await expect(page.getByTestId('block-reason')).toHaveText('CAPITAL_EXCEEDED');
  });

  test('add 動作 + 資金爆表：與 buy 一致擋下', async ({ page }) => {
    await page.goto(
      '/e2e/journal-authoring-harness?ac=us_stock&action=add&sym=AAPL&qty=1000&price=200&capital=100000',
    );
    await expect(page.getByTestId('capital-exceeded')).toHaveText('true');
    await expect(page.getByTestId('block-reason')).toHaveText('CAPITAL_EXCEEDED');
  });

  test('美股用戶輸入「張」→ sanitize 為「股」，不再誤觸 UNIT_CONFLICT / 資金爆表', async ({ page }) => {
    await page.goto(
      '/e2e/journal-authoring-harness?ac=us_stock&action=buy&sym=AAPL&qty=10&price=200&capital=100000&userUnit=張',
    );
    await expect(page.getByTestId('resolved-unit')).toHaveText('股');
    await expect(page.getByTestId('notional')).toHaveText('2000');
    await expect(page.getByTestId('capital-exceeded')).toHaveText('false');
    await expect(page.getByTestId('can-publish')).toHaveText('true');
  });

  test('賣出時歷史庫存單位與目前單位不同 → UNIT_CONFLICT', async ({ page }) => {
    // 台股歷史庫存記為「股」，但現在賣「張」→ 觸發 UNIT_CONFLICT
    await page.goto(
      '/e2e/journal-authoring-harness?ac=tw_stock&action=sell&sym=2330&qty=1&price=600&invQty=1000&invUnit=%E8%82%A1&userUnit=%E5%BC%B5',
    );
    await expect(page.getByTestId('resolved-unit')).toHaveText('張');
    await expect(page.getByTestId('unit-conflict')).toHaveText('true');
    await expect(page.getByTestId('block-reason')).toHaveText('UNIT_CONFLICT');
  });

  test('teaching / hold：不觸發資金 / oversell（純教學週記）', async ({ page }) => {
    await page.goto(
      '/e2e/journal-authoring-harness?ac=tw_stock&action=teaching&sym=2330&qty=99999&price=99999&capital=1',
    );
    await expect(page.getByTestId('can-publish')).toHaveText('true');
    await expect(page.getByTestId('block-reason')).toHaveText('none');
  });
});
