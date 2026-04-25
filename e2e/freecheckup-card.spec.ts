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

async function gotoFreeCheckup(page: Page) {
  // Reset persisted state so card content is deterministic across runs.
  await page.addInitScript(() => {
    try {
      // Seed demo mode flag if the app reads it; otherwise the page boots
      // with the bundled SEED_HOLDINGS which is already deterministic.
      window.localStorage.setItem('checkup-demo-mode', '1');
    } catch {}
  });
  await page.goto(ROUTE, { waitUntil: 'networkidle' });
  // Card root mounts after holdings derive — wait explicitly.
  await page.waitForSelector('.wb-card', { state: 'visible', timeout: 15_000 });
  // Allow one rAF cycle for clamp() font-size to settle.
  await page.waitForTimeout(150);
}

/**
 * Returns true if the inline children of `.wb-bottom` and `.wb-roi`
 * fit within their parent's client box (no horizontal overflow).
 */
async function assertNoOverflow(page: Page) {
  const issues = await page.$$eval('.wb-card', (cards) => {
    const problems: {
      cardIndex: number;
      type: string;
      detail: string;
    }[] = [];

    cards.forEach((card, idx) => {
      const cardRect = card.getBoundingClientRect();

      // ROI block: must not exceed card right-edge and must not be clipped
      // (scrollWidth > clientWidth means the text was forcibly truncated by
      // overflow:hidden — acceptable — but boundingRect must still be inside).
      const roi = card.querySelector<HTMLElement>('.wb-roi');
      if (roi) {
        const r = roi.getBoundingClientRect();
        if (r.right - cardRect.right > 1) {
          problems.push({
            cardIndex: idx,
            type: 'roi-overflow',
            detail: `roi.right=${r.right.toFixed(2)} card.right=${cardRect.right.toFixed(2)}`,
          });
        }
        if (roi.scrollWidth - roi.clientWidth > 1) {
          problems.push({
            cardIndex: idx,
            type: 'roi-clipped',
            detail: `scrollWidth=${roi.scrollWidth} clientWidth=${roi.clientWidth}`,
          });
        }
      }

      // Footer (TODAY/VALUE) block + each child span
      const bottom = card.querySelector<HTMLElement>('.wb-bottom');
      if (bottom) {
        const b = bottom.getBoundingClientRect();
        if (b.right - cardRect.right > 1) {
          problems.push({
            cardIndex: idx,
            type: 'bottom-overflow',
            detail: `bottom.right=${b.right.toFixed(2)} card.right=${cardRect.right.toFixed(2)}`,
          });
        }
        if (bottom.scrollWidth - bottom.clientWidth > 1) {
          problems.push({
            cardIndex: idx,
            type: 'bottom-grid-overflow',
            detail: `scrollWidth=${bottom.scrollWidth} clientWidth=${bottom.clientWidth}`,
          });
        }

        bottom.querySelectorAll<HTMLElement>('span').forEach((span, spanIdx) => {
          const s = span.getBoundingClientRect();
          if (s.right - cardRect.right > 1) {
            problems.push({
              cardIndex: idx,
              type: `bottom-span-${spanIdx}-overflow`,
              detail: `span.right=${s.right.toFixed(2)} card.right=${cardRect.right.toFixed(2)} text="${span.textContent?.trim().slice(0, 30)}"`,
            });
          }
        });
      }
    });

    return problems;
  });

  expect(issues, `Card overflow detected:\n${JSON.stringify(issues, null, 2)}`).toEqual([]);
}

test.describe('FreeCheckup mobile card', () => {
  test('cards never overflow ROI / TODAY / VALUE', async ({ page }) => {
    await gotoFreeCheckup(page);
    await assertNoOverflow(page);
  });

  test('first card visual matches baseline', async ({ page }, testInfo) => {
    await gotoFreeCheckup(page);
    const firstCard = page.locator('.wb-card').first();
    await expect(firstCard).toBeVisible();

    // Stabilise: hide elements that animate or pull network data after mount.
    await page.addStyleTag({
      content: `
        .wb-spark { visibility: hidden !important; }
        * { animation: none !important; transition: none !important; }
      `,
    });
    await page.waitForTimeout(100);

    await expect(firstCard).toHaveScreenshot(
      `wb-card-first-${testInfo.project.name}.png`,
      { maxDiffPixelRatio: 0.02 }
    );
  });
});
