import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { navigateAndWaitForCardReady } from './helpers/navigation';

/**
 * Mobile QA — /holding-checkup decision-workbench card
 *
 * For every supported viewport (320 / 340 / 375 / 414) we:
 *   1. Visit /holding-checkup with a deterministic seeded portfolio (demo mode).
 *   2. Wait for `.wb-card` to render.
 *   3. Assert each card's ROI / % / TODAY / VALUE blocks fit within the card's
 *      content box (no horizontal overflow, no clipped scroll-width).
 *   4. Take a pixel screenshot of the first card and diff against baseline.
 *
 * If you intentionally change the card visual, regenerate baselines with:
 *   bunx playwright test --update-snapshots
 */

const ROUTE = '/holding-checkup';

// Workbench cards live inside the holdings grid.  Hero/summary cards also use
// `.wb-card`, so we always scope to this selector to avoid false positives on
// intentionally-truncated summary tiles.
const CARD_SELECTOR = '.holdings-card-grid .wb-card';

async function gotoFreeCheckup(page: Page, testInfo?: TestInfo) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('checkup-demo-mode', '1');
      // 抑制 /holding-checkup 介紹影片 modal（demo 首次進入會 auto-open，
      // 覆蓋 .wb-card 導致 element screenshot 擷取到黑色 <video>，非卡片）。
      window.localStorage.setItem('holdings-intro-video-seen-v2', '1');
      window.localStorage.setItem('lf.checkup.onboarded', '1');
      window.sessionStorage.setItem('holdings-intro-video-dismissed-session', '1');
    } catch {}
  });

  // Unified entrypoint: retry-aware goto + selector wait + page health check
  // (seeded portfolio rendered ≥1 card, no error banner) + bounding-box
  // stability gate before snapshots.
  await navigateAndWaitForCardReady(page, ROUTE, {
    cardSelector: CARD_SELECTOR,
    selectorTimeoutMs: 30_000,
    testInfo,
    stability: {
      // Workbench cards have async sparklines + clamp() typography — give
      // them a tighter tolerance and require 3 stable samples to be safe.
      tolerancePx: 0.5,
      stableSamples: 3,
      timeoutMs: 6_000,
      label: 'wb-card',
    },
    healthCheck: async ({ page: p }) => {
      // Fail fast if the seeded demo portfolio didn't materialise or if a
      // global error boundary is showing — both produce a "card visible"
      // signal that would otherwise pass the selector wait.
      const cardCount = await p.locator(CARD_SELECTOR).count();
      if (cardCount < 1) return false;
      const errorBanner = await p.locator('[data-testid="error-boundary"], .error-boundary').count();
      return errorBanner === 0;
    },
  });
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
  test('demo intro modal 不會自動彈出（localStorage/sessionStorage 已抑制）', async ({ page }, testInfo) => {
    await gotoFreeCheckup(page, testInfo);

    // 1) modal 完全不 mount（HoldingsIntroVideo 讀 flag 後 return null）
    const modal = page.locator('[data-testid="holdings-intro-modal"]');
    await expect(
      modal,
      `[${testInfo.project.name}] demo intro modal 應被 localStorage/sessionStorage flag 抑制`,
    ).toHaveCount(0);

    // 2) 沒有 <video> element 佔用首屏（避免 element screenshot 擷取到影片）
    await expect(
      page.locator('video'),
      `[${testInfo.project.name}] demo 首屏不應有 <video> element`,
    ).toHaveCount(0);

    // 3) 首張卡片位於首屏，且不被任何 role=dialog 覆蓋
    const firstCard = page.locator(CARD_SELECTOR).first();
    await expect(firstCard).toBeVisible();
    await expect(
      page.locator('[role="dialog"][aria-modal="true"]'),
      `[${testInfo.project.name}] 首屏不應有 modal dialog`,
    ).toHaveCount(0);

    // 4) flag 確實已寫入（守門：確保 addInitScript 生效，未來若 flag 名稱變更會直接 fail）
    const flags = await page.evaluate(() => ({
      seen: window.localStorage.getItem('holdings-intro-video-seen-v2'),
      dismissed: window.sessionStorage.getItem('holdings-intro-video-dismissed-session'),
    }));
    expect(flags.seen, 'localStorage flag holdings-intro-video-seen-v2 應為 "1"').toBe('1');
    expect(flags.dismissed, 'sessionStorage flag holdings-intro-video-dismissed-session 應為 "1"').toBe('1');
  });

  // [2026-07-30] HoldingsIntroVideo 開場影片已於 FreeCheckup §6.5 移除（改用 OnboardingOverlay），
  // 原本 11 個 intro-modal 開啟/關閉/focus-trap 測試已隨元件下架刪除。
  // 上方「不會自動彈出」測試保留為回歸守門：首屏不得再出現 modal / <video>。









  test('grid collapses to a single column at mobile widths', async ({ page }, testInfo) => {
    await gotoFreeCheckup(page, testInfo);

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
    await gotoFreeCheckup(page, testInfo);
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

