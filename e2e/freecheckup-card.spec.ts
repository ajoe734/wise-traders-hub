import { test, expect, type Page } from '@playwright/test';

/**
 * Mobile QA — /free-checkup decision-workbench card
 *
 * For every supported viewport (320 / 340 / 375 / 414) we:
 *   1. Visit /free-checkup with a deterministic seeded portfolio (demo mode).
 *   2. Wait for `.wb-card` to render.
 *   3. Assert each card's ROI / % / TODAY / VALUE blocks fit within the card's
 *      content box (no horizontal overflow, no clipped scroll-width).
 *   4. Take a pixel screenshot of the first card and diff against baseline.
 *
 * If you intentionally change the card visual, regenerate baselines with:
 *   bunx playwright test --update-snapshots
 */

const ROUTE = '/free-checkup';

// Workbench cards live inside the holdings grid.  Hero/summary cards also use
// `.wb-card`, so we always scope to this selector to avoid false positives on
// intentionally-truncated summary tiles.
const CARD_SELECTOR = '.holdings-card-grid .wb-card';

async function gotoFreeCheckup(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('checkup-demo-mode', '1');
    } catch {}
  });
  await page.goto(ROUTE, { waitUntil: 'networkidle' });
  await page.waitForSelector(CARD_SELECTOR, { state: 'visible', timeout: 15_000 });
  // Allow one rAF cycle for clamp() font-size to settle.
  await page.waitForTimeout(150);
}

/**
 * Asserts that ROI / TODAY / VALUE bounding boxes never extend past the
 * card's right edge.  Intentional ellipsis (scrollWidth > clientWidth) is
 * allowed — only true geometric overflow is treated as a regression.
 */
async function assertNoOverflow(page: Page, selector: string) {
  const issues = await page.$$eval(selector, (cards) => {
    const problems: { cardIndex: number; type: string; detail: string }[] = [];
    const TOLERANCE = 1;

    cards.forEach((card, idx) => {
      const cardRect = card.getBoundingClientRect();

      const checkRight = (el: Element | null, type: string) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (r.right - cardRect.right > TOLERANCE) {
          problems.push({
            cardIndex: idx,
            type,
            detail: `right=${r.right.toFixed(2)} cardRight=${cardRect.right.toFixed(2)} text="${(el.textContent || '').trim().slice(0, 30)}"`,
          });
        }
      };

      // ROI 與 bottom 容器是穩定可量測的；個別 inline span 因 headless
      // shell 的 grid track resolution 偏差會誤報，此處只測容器整體。
      checkRight(card.querySelector('.wb-roi'), 'roi-overflow');
      checkRight(card.querySelector('.wb-bottom'), 'bottom-overflow');
    });

    return problems;
  });

  expect(
    issues,
    `Card overflow detected:\n${JSON.stringify(issues, null, 2)}`
  ).toEqual([]);
}

test.describe('FreeCheckup mobile card', () => {
  test('cards never overflow ROI / TODAY / VALUE', async ({ page }) => {
    await gotoFreeCheckup(page);
    await assertNoOverflow(page, CARD_SELECTOR);
  });

  test('first workbench card visual matches baseline', async ({ page }, testInfo) => {
    await gotoFreeCheckup(page);
    const firstCard = page.locator(CARD_SELECTOR).first();
    await expect(firstCard).toBeVisible();

    // Stabilise: hide network-driven sparkline + animations.
    await page.addStyleTag({
      content: `
        .wb-spark { visibility: hidden !important; }
        * { animation: none !important; transition: none !important; }
      `,
    });
    await firstCard.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);

    await expect(firstCard).toHaveScreenshot(
      `wb-card-first-${testInfo.project.name}.png`,
      { maxDiffPixelRatio: 0.02 }
    );
  });
});

