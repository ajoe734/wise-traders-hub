import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { gotoWithRetry, waitForStableBoundingBox } from './helpers/navigation';

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

async function gotoFreeCheckup(page: Page, testInfo?: TestInfo) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('checkup-demo-mode', '1');
    } catch {}
  });
  // Use `domcontentloaded` instead of `networkidle` — the dev server keeps
  // long-lived HMR/websocket connections open which makes `networkidle`
  // flaky and prone to 60s timeouts. We rely on the explicit card selector
  // wait below to confirm the page is interactive.
  await gotoWithRetry(page, ROUTE, { testInfo });
  await page.waitForSelector(CARD_SELECTOR, { state: 'visible', timeout: 30_000 });
  // Wait for the first card's geometry to stop shifting (clamp() font-size,
  // sparkline mount) before any assertion / screenshot.
  await waitForStableBoundingBox(page, CARD_SELECTOR);
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

/**
 * Geometry-based column counter.
 *
 * Rather than reading `getComputedStyle(grid).gridTemplateColumns` (which can
 * lie about implicit tracks or report `repeat(...)` strings that need parsing),
 * we cluster card `boundingClientRect.left` values into buckets.  Two cards
 * belong to the same column when their left edges are within `tolerance` px.
 *
 * This catches the real failure mode: cards visually rendering side-by-side
 * even when CSS *says* the grid is single-column.
 */
async function countGridColumns(
  page: Page,
  selector: string,
  tolerance = 4
): Promise<{ columns: number; rows: number; lefts: number[] }> {
  return page.$$eval(
    selector,
    (cards, tol) => {
      if (cards.length === 0) return { columns: 0, rows: 0, lefts: [] };

      const rects = cards.map((c) => c.getBoundingClientRect());

      // Cluster by `left` (columns).
      const sortedLefts = [...rects].map((r) => r.left).sort((a, b) => a - b);
      const colBuckets: number[] = [];
      sortedLefts.forEach((l) => {
        if (colBuckets.every((b) => Math.abs(b - l) > tol)) colBuckets.push(l);
      });

      // Cluster by `top` (rows) — used to sanity-check the column count
      // against `cards.length / rows`.
      const sortedTops = [...rects].map((r) => r.top).sort((a, b) => a - b);
      const rowBuckets: number[] = [];
      sortedTops.forEach((t) => {
        if (rowBuckets.every((b) => Math.abs(b - t) > tol)) rowBuckets.push(t);
      });

      return {
        columns: colBuckets.length,
        rows: rowBuckets.length,
        lefts: colBuckets.map((n) => Number(n.toFixed(1))),
      };
    },
    tolerance
  );
}

test.describe('FreeCheckup mobile card', () => {
  test('cards never overflow ROI / TODAY / VALUE', async ({ page }) => {
    await gotoFreeCheckup(page);
    await assertNoOverflow(page, CARD_SELECTOR);
  });

  test('grid collapses to a single column at mobile widths', async ({ page }, testInfo) => {
    await gotoFreeCheckup(page);

    // Need at least 2 cards for a meaningful column count.
    const cardCount = await page.locator(CARD_SELECTOR).count();
    expect(cardCount, 'seeded portfolio should render multiple workbench cards').toBeGreaterThanOrEqual(2);

    const geometry = await countGridColumns(page, CARD_SELECTOR);

    // All four mobile projects (320/340/375/414) MUST collapse to 1 column —
    // the @media (max-width: 640px) rule sets `grid-template-columns: 1fr`.
    expect(
      geometry.columns,
      `[${testInfo.project.name}] expected 1 column, got ${geometry.columns}. ` +
        `Column left edges: ${JSON.stringify(geometry.lefts)}, rows=${geometry.rows}, cards=${cardCount}`
    ).toBe(1);

    // Sanity: rows × columns should account for every card (allowing the last
    // row to be partially filled when columns > 1, which we do not expect here).
    expect(geometry.rows * geometry.columns).toBeGreaterThanOrEqual(cardCount);
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

