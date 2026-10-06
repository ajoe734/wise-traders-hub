import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 1000 } });

test.describe('journal current holdings grid', () => {
  test('彥愷六檔持股位於週記標題前，預設三檔並支援鍵盤展開', async ({ page }) => {
    await page.goto('/e2e/journal-current-holdings-harness');
    await expect(page.getByTestId('journal-holdings-harness-marker')).toHaveText('JOURNAL_CURRENT_HOLDINGS_V1');
    const section = page.getByTestId('journal-current-holdings');
    await expect(section).toBeVisible();
    await expect(section.getByTestId('journal-holding-card')).toHaveCount(3);
    await expect(section.getByText('期元大S&P黃金正2')).toBeVisible();
    await expect(section.getByText('報價更新中').first()).toBeVisible();
    const toggle = section.getByTestId('journal-holdings-toggle');
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(section.getByTestId('journal-holding-card')).toHaveCount(6);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const ordering = await page.locator('[data-testid="journal-current-holdings"], h1').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid') || node.textContent));
    expect(ordering[0]).toBe('journal-current-holdings');
    expect(ordering[1]).toContain('本週操作回顧');
  });

  for (const state of ['loading', 'error', 'empty', 'review']) {
    test(`${state} 狀態可見且不產生水平溢出`, async ({ page }) => {
      await page.goto(`/e2e/journal-current-holdings-harness?state=${state}`);
      await expect(page.getByTestId('journal-current-holdings')).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  for (const width of [1280, 560, 390, 380]) {
    test(`${width}px 無水平溢出且所有文字留在卡片內`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto('/e2e/journal-current-holdings-harness');
      const section = page.getByTestId('journal-current-holdings');
      await expect(section).toBeVisible();
      const result = await section.evaluate((element) => {
        const cards = Array.from(element.querySelectorAll<HTMLElement>('[data-testid="journal-holding-card"]'));
        return {
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          cardsOverflowing: cards.filter((card) => card.scrollWidth > card.clientWidth + 1).length,
          columns: cards.length > 1 ? Math.round(cards[1].getBoundingClientRect().left - cards[0].getBoundingClientRect().left) : 0,
        };
      });
      expect(result.pageOverflow).toBeLessThanOrEqual(0);
      expect(result.cardsOverflowing).toBe(0);
      if (width >= 1280) expect(result.columns).toBeGreaterThan(0);
    });
  }
});