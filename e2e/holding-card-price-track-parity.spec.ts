import { test, expect } from '@playwright/test';
import { gotoHarness } from './helpers/holdingCardHarness';

/**
 * PriceTrack 文字合約回歸：costStr / priceStr / decText
 * 覆蓋 null / 0 / 正 / 負 / 大數 / 標點裁切 / normal vs ink 邊界。
 * 期望值以複寫的 truncateAction 於測試中即時計算，元件邏輯變動即 fail。
 */

function truncateAction(txt: string | null | undefined, limit: number): string {
  if (!txt || txt.length <= limit) return txt ?? '';
  const head = txt.slice(0, limit);
  const m = head.match(/^(.*[。、，；！？,.;!?])[^。、，；！？,.;!?]*$/);
  const cut = m ? m[1] : head.slice(0, limit - 2);
  return cut + '…';
}

function expectedDec(fx: {
  dec?: { actionText?: string | null } | null;
  meta?: { strategy?: string | null } | null;
  variant?: 'normal' | 'ink';
}): string {
  const isFeature = fx.variant === 'ink';
  const decLimit = isFeature ? 90 : 60;
  const decFallback = isFeature
    ? (fx.meta?.strategy || '持續監控基本面與籌碼變動。')
    : (fx.meta?.strategy ? fx.meta!.strategy!.slice(0, 40) : '');
  return fx.dec?.actionText ? truncateAction(fx.dec.actionText, decLimit) : decFallback;
}

function fmt(v: number | null | undefined): string {
  return v != null ? Number(v).toFixed(2) : '—';
}

type Case = {
  name: string;
  h: { cost?: number | null; price?: number | null };
  meta?: { strategy?: string | null } | null;
  dec?: { actionText?: string | null } | null;
  variant?: 'normal' | 'ink';
};

const cases: Case[] = [
  { name: 'both null', h: { cost: null, price: null } },
  { name: 'zero cost / positive price / short strategy', h: { cost: 0, price: 100 }, meta: { strategy: 'A' } },
  { name: 'toFixed rounding boundary', h: { cost: 12, price: 12.345 } },
  { name: 'large numbers rounding up', h: { cost: 1234567.891, price: 999999.999 } },
  { name: 'negative cost/price', h: { cost: -50.5, price: -0.004 } },
  { name: 'dec short original', h: { cost: 100, price: 110 }, dec: { actionText: '短句' } },
  { name: 'dec exactly at 60 limit (normal)', h: { cost: 100, price: 110 }, dec: { actionText: 'X'.repeat(60) } },
  { name: 'dec over 60 limit (normal) → truncated with …', h: { cost: 100, price: 110 }, dec: { actionText: 'X'.repeat(65) } },
  { name: 'dec with punctuation break', h: { cost: 100, price: 110 }, dec: { actionText: 'A。' + 'B'.repeat(80) } },
  { name: 'dec over 90 limit (ink)', h: { cost: 100, price: 110 }, dec: { actionText: 'Y'.repeat(120) }, variant: 'ink' },
  { name: 'dec null → strategy sliced to 40 (normal)', h: { cost: 100, price: 110 }, meta: { strategy: 'S'.repeat(60) } },
  { name: 'dec null → strategy full (ink)', h: { cost: 100, price: 110 }, meta: { strategy: 'S'.repeat(120) }, variant: 'ink' },
  { name: 'dec null + strategy null (ink) → fallback constant', h: { cost: 100, price: 110 }, variant: 'ink' },
];

test.describe.parallel('HoldingCardPriceTrack 文字合約', () => {
  for (const c of cases) {
    test(c.name, async ({ page }) => {
      await gotoHarness(page, {
        h: c.h,
        meta: c.meta ?? null,
        dec: c.dec ?? null,
        variant: c.variant ?? 'normal',
      });

      const row = page.locator('#harness-root > div').first();
      const cost = row.locator('xpath=./span[text()="成本"]/following-sibling::span[1]');
      const price = row.locator('xpath=./span[text()="現價"]/following-sibling::span[1]');
      const decDiv = page.locator('#harness-root > div').nth(1).locator('> div');

      await expect(cost).toHaveText(fmt(c.h.cost));
      await expect(price).toHaveText(fmt(c.h.price));

      const expected = expectedDec(c);
      // textContent 完全等於 expected（空字串亦然）
      const actual = (await decDiv.textContent()) ?? '';
      expect(actual).toBe(expected);
      if (expected.endsWith('…')) {
        expect(expected.length).toBeLessThanOrEqual(c.variant === 'ink' ? 90 : 60);
      }
    });
  }
});
