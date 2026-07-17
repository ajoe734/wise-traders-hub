/**
 * E2E 回歸 — HoldingsDetailPanel ROI 字級守門
 *
 * 憲法：抽屜大字 ROI（`[data-testid="drawer-roi-main"]`）
 *   - computed `fontSize` **必須 ≤ 22px**（是枝裕和極簡美學上限）
 *   - `fontWeight` 必須 ≤ 500（避免變粗回歸）
 *   - `lineHeight` 為數值時需 ≤ 32px（避免行距爆掉）
 *
 * 跨斷點：320 / 375 / 390 / 414 / 560 / 768 / 1024 / 1280
 *   （project 由 playwright.config.ts `holdings-detail-roi-fontsize-*` 注入 viewport，
 *    這裡讀 `testInfo.project.use.viewport?.width`，避免手動改兩處）
 *
 * 走 `/holding-checkup-demo` demo 環境 → dblclick `.wb-card` 開抽屜 → 讀 computed style。
 */
import { test, expect, type Page } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';

const MAX_FONT_PX = 22;
const MAX_FONT_WEIGHT = 500;
const MAX_LINE_HEIGHT_PX = 32;

async function primeDemo(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('checkup-coach-seen-v1', '1');
      window.localStorage.setItem('holdings-intro-video-seen-v2', '1');
      window.localStorage.setItem('lf.checkup.onboarded', '1');
      window.sessionStorage.setItem('holdings-intro-video-dismissed-session', '1');
      window.localStorage.setItem('checkup-onboarding-tour-v1', 'done');
    } catch {}
  });
}

test.describe('HoldingsDetailPanel · ROI 字級守門', () => {
  test('drawer-roi-main computed fontSize ≤ 22px（跨斷點）', async ({ page }, testInfo) => {
    const width = testInfo.project.use.viewport?.width ?? 1280;

    await primeDemo(page);
    await gotoWithRetry(page, '/holding-checkup-demo', { waitUntil: 'domcontentloaded' });

    // 等第一張持倉卡渲染完成
    const firstCard = page.locator('.wb-card').first();
    await firstCard.waitFor({ state: 'visible', timeout: 15_000 });
    await firstCard.scrollIntoViewIfNeeded();

    // 打開抽屜（單擊即開；dblclick 保險）
    await firstCard.click();
    const panel = page.locator('[data-testid="holdings-detail-panel"]').first();
    await panel.waitFor({ state: 'visible', timeout: 15_000 });

    // 等自架字型載入完，避免 fallback 字寬造成 layout jitter
    await page.evaluate(() => document.fonts?.ready);
    await page.waitForTimeout(200);

    const roi = panel.locator('[data-testid="drawer-roi-main"]').first();
    await expect(roi, `ROI 大字節點需存在 @ ${width}px`).toBeVisible();

    // 讀 computed style —— 主節點 + 內部子 span（%、原/回退字）都要一起量
    const measurements = await roi.evaluate((el) => {
      const nodes: Element[] = [el, ...Array.from(el.querySelectorAll('*'))];
      return nodes.map((n) => {
        const cs = window.getComputedStyle(n);
        return {
          tag: n.tagName.toLowerCase(),
          text: (n.textContent ?? '').trim().slice(0, 40),
          fontSizePx: parseFloat(cs.fontSize),
          fontWeight: Number(cs.fontWeight) || 400,
          lineHeightPx: cs.lineHeight === 'normal' ? null : parseFloat(cs.lineHeight),
        };
      });
    });

    expect(measurements.length, 'ROI 節點應該至少包含主 span').toBeGreaterThan(0);

    for (const m of measurements) {
      expect(
        m.fontSizePx,
        `[${width}px] <${m.tag}> "${m.text}" fontSize=${m.fontSizePx}px 超過憲法上限 ${MAX_FONT_PX}px`,
      ).toBeLessThanOrEqual(MAX_FONT_PX);

      expect(
        m.fontWeight,
        `[${width}px] <${m.tag}> "${m.text}" fontWeight=${m.fontWeight} 超過憲法上限 ${MAX_FONT_WEIGHT}`,
      ).toBeLessThanOrEqual(MAX_FONT_WEIGHT);

      if (m.lineHeightPx != null && Number.isFinite(m.lineHeightPx)) {
        expect(
          m.lineHeightPx,
          `[${width}px] <${m.tag}> "${m.text}" lineHeight=${m.lineHeightPx}px 超過 ${MAX_LINE_HEIGHT_PX}px`,
        ).toBeLessThanOrEqual(MAX_LINE_HEIGHT_PX);
      }
    }

    // 額外守門：ROI 大字盒不得溢出抽屜寬（避免 22px + `-100.00%` 在 320px 撞邊）
    const roiBox = await roi.boundingBox();
    const panelBox = await panel.boundingBox();
    if (roiBox && panelBox) {
      expect(
        roiBox.x + roiBox.width,
        `[${width}px] ROI 大字右緣 ${roiBox.x + roiBox.width} 超過抽屜右緣 ${panelBox.x + panelBox.width}`,
      ).toBeLessThanOrEqual(panelBox.x + panelBox.width + 0.5);
    }
  });
});
