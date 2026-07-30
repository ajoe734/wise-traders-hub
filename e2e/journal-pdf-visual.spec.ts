/**
 * Journal PDF 匯出 — 視覺回歸守門
 *
 * 目的：exportJournalPdf 的字型（Source Serif 4 / Noto Serif TC / Noto Sans TC）
 *      與 accent 色（#EC662D 品牌橘 + 5 種 action badge 色）不能漂移。
 *
 * 做法：/e2e/journal-pdf-harness 直接把 renderJournalPageHtmls 產生的每頁 HTML
 *      掛到 DOM 上（不進 html2canvas / jsPDF），Playwright 對每頁 794px 固定寬度
 *      的節點截圖比對，並額外斷言關鍵元素的 computed color / font-family。
 *
 * 頁面本身固定 794×1123 px，跨 viewport 內容尺寸不會變；跑多個 viewport 是為了
 *      catch 「外層 layout 破 clip / 字型延遲載入導致 fallback」這類問題。
 */
import { test, expect, type Page } from '@playwright/test';

const ACCENT = 'rgb(236, 102, 45)'; // #EC662D
const BADGE_COLORS: Record<string, string> = {
  buy: 'rgb(217, 72, 72)',    // #D94848
  sell: 'rgb(46, 139, 87)',   // #2E8B57
  add: 'rgb(59, 130, 246)',   // #3B82F6
  trim: 'rgb(245, 158, 11)',  // #F59E0B
  exit: 'rgb(100, 116, 139)', // #64748B
};

async function openHarness(page: Page) {
  const errors: string[] = [];
  const IGNORE = [/traffic-ingest/i, /Failed to load resource/i, /CORS/i];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (IGNORE.some((rx) => rx.test(t))) return;
    errors.push(t);
  });

  await page.goto('/e2e/journal-pdf-harness', { waitUntil: 'domcontentloaded' });

  // 等 harness ready + 至少一頁掛上
  await page.waitForSelector('[data-pdf-harness-status="ready"]', { timeout: 30_000 });
  await page.waitForSelector('[data-pdf-page="1"]', { timeout: 15_000 });

  // 字型完全載入後才截圖
  await page.evaluate(() => (document as any).fonts?.ready);
  // 給 layout 一個 frame 沉澱
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));

  return { errors };
}

test.describe('journal-pdf-visual', () => {
  test('每頁固定 794×1123、accent 品牌橘 + 5 種 action badge 色皆正確', async ({ page }, testInfo) => {
    const { errors } = await openHarness(page);
    expect(errors, `harness console/page errors: ${errors.join(' | ')}`).toEqual([]);

    const pageCount = await page.locator('[data-pdf-page]').count();
    expect(pageCount, 'cover + 操作回顧 + 成交明細 + 產業分佈 ≥ 4').toBeGreaterThanOrEqual(4);

    // 每個 PDF 頁面尺寸必須固定
    for (let i = 1; i <= pageCount; i++) {
      const el = page.locator(`[data-pdf-page="${i}"] > div`).first();
      const box = await el.boundingBox();
      expect(box, `page ${i} bbox`).not.toBeNull();
      expect(Math.round(box!.width)).toBe(794);
      expect(Math.round(box!.height)).toBe(1123);
    }

    // Cover 標題必須是 Source Serif 4（未載入時會 fallback 到 Georgia，寬度差 > 5px）
    const coverH1 = page.locator('[data-pdf-page="1"] h1').first();
    const coverFontFamily = await coverH1.evaluate((n) => getComputedStyle(n).fontFamily);
    expect(coverFontFamily.toLowerCase()).toContain('source serif 4');

    // Cover 品牌橘點 · 顏色
    const brandDot = page.locator('[data-pdf-page="1"] span[style*="color:#EC662D"], [data-pdf-page="1"] span[style*="color: rgb(236"]').first();
    if (await brandDot.count()) {
      const c = await brandDot.evaluate((n) => getComputedStyle(n).color);
      expect(c).toBe(ACCENT);
    }

    // 章節標題底線（40×2 橘條）— 至少一個 h2 之後跟著品牌橘 divider
    const dividerColor = await page.evaluate((expected) => {
      const nodes = Array.from(document.querySelectorAll('[data-pdf-page] div'));
      for (const n of nodes) {
        const st = getComputedStyle(n as HTMLElement);
        if (st.width === '40px' && st.height === '2px' && st.backgroundColor === expected) return st.backgroundColor;
      }
      return null;
    }, ACCENT);
    expect(dividerColor, '章節標題橘色 divider (#EC662D)').toBe(ACCENT);

    // 5 種 action badge 色 — 由文字定位（buy/add/trim/sell/exit 對應中文）
    const badgeChecks: Array<[string, string]> = [
      ['買進', BADGE_COLORS.buy],
      ['加碼', BADGE_COLORS.add],
      ['減碼', BADGE_COLORS.trim],
      ['賣出', BADGE_COLORS.sell],
      ['平損', BADGE_COLORS.exit],
    ];
    for (const [label, expectedBg] of badgeChecks) {
      const badge = page.locator(`[data-pdf-page] div:has-text("${label}")`).filter({
        hasText: new RegExp(`^${label}$`),
      }).first();
      await expect(badge, `action badge "${label}"`).toBeVisible();
      const bg = await badge.evaluate((n) => getComputedStyle(n).backgroundColor);
      expect(bg, `${label} badge background`).toBe(expectedBg);
      const color = await badge.evaluate((n) => getComputedStyle(n).color);
      expect(color, `${label} badge fg`).toBe('rgb(255, 255, 255)');
    }

    // 學習重點的橘色項目符號
    const bulletColor = await page.evaluate((expected) => {
      const nodes = Array.from(document.querySelectorAll('[data-pdf-page] li span'));
      for (const n of nodes) {
        if ((n.textContent || '').trim() === '•') {
          const c = getComputedStyle(n as HTMLElement).color;
          if (c === expected) return c;
        }
      }
      return null;
    }, ACCENT);
    expect(bulletColor, '學習重點橘色項目符號').toBe(ACCENT);

    // 逐頁像素快照（cover + 操作回顧 + 成交明細 + 產業分佈）
    // 學習重點頁排在最後、字體與其他頁共用，不再重複 baseline。
    await expect(page.locator('[data-pdf-page="1"]')).toHaveScreenshot(
      `journal-pdf-cover-${testInfo.project.name}.png`,
      { maxDiffPixelRatio: 0.02 },
    );
    await expect(page.locator('[data-pdf-page="2"]')).toHaveScreenshot(
      `journal-pdf-page2-${testInfo.project.name}.png`,
      { maxDiffPixelRatio: 0.02 },
    );

    // 成交明細頁 —— 頁序會因「操作回顧」內容長度而分頁位移，改以內容定位。
    const tradeDetailPage = page
      .locator('[data-pdf-page]')
      .filter({ has: page.locator('table[data-pdf-trade-detail]') })
      .first();
    await expect(tradeDetailPage, '成交明細頁').toBeVisible();
    const tradeTable = tradeDetailPage.locator('table[data-pdf-trade-detail]');
    await expect(tradeTable, '成交明細 table').toBeVisible();
    const bodyRows = tradeTable.locator('tbody tr');
    expect(await bodyRows.count(), '成交明細列數').toBe(5);
    for (const [label, expectedBg] of badgeChecks) {
      const cell = tradeTable.locator(`tbody tr td span:has-text("${label}")`).filter({
        hasText: new RegExp(`^${label}$`),
      }).first();
      await expect(cell, `成交明細 badge "${label}"`).toBeVisible();
      const bg = await cell.evaluate((n) => getComputedStyle(n).backgroundColor);
      expect(bg, `成交明細 ${label} badge bg`).toBe(expectedBg);
    }
    await expect(tradeDetailPage).toHaveScreenshot(
      `journal-pdf-trade-detail-${testInfo.project.name}.png`,
      { maxDiffPixelRatio: 0.02 },
    );

    // 產業分佈頁 —— 3 類（半導體 / 電子零組件 / 航運），bar 為品牌橘
    const sectorPage = page
      .locator('[data-pdf-page]')
      .filter({ has: page.locator('[data-pdf-sector-distribution]') })
      .first();
    await expect(sectorPage, '產業分佈頁').toBeVisible();
    const sectorBlock = sectorPage.locator('[data-pdf-sector-distribution]');
    await expect(sectorBlock, '產業分佈 block').toBeVisible();
    for (const sectorName of ['半導體', '電子零組件', '航運']) {
      await expect(
        sectorBlock.locator(`div:has-text("${sectorName}")`).first(),
        `sector row "${sectorName}"`,
      ).toBeVisible();
    }
    // bar 顏色守門：至少一條產業 bar 用品牌橘（避免混入 action 色）
    const orangeBars = await sectorBlock.evaluate((root, expected) => {
      const nodes = Array.from(root.querySelectorAll('div'));
      return nodes.filter((n) => getComputedStyle(n as HTMLElement).backgroundColor === expected).length;
    }, ACCENT);
    expect(orangeBars, '產業分佈品牌橘 bar 數').toBeGreaterThanOrEqual(3);
    await expect(sectorPage).toHaveScreenshot(
      `journal-pdf-sector-distribution-${testInfo.project.name}.png`,
      { maxDiffPixelRatio: 0.02 },
    );

  });
});
