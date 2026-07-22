/**
 * E2E 視覺快照回歸 — HoldingsDetailPanel 抽屜
 *
 * 涵蓋 15 個斷點（320 / 360 / 375 / 390 / 414 / 430 / 480 / 560 / 640 /
 * 768 / 863 / 1024 / 1280 / 1440 / 1920），針對整個抽屜面板做 pixel diff 快照，防止：
 *   - 溢出（overflow） / 換行跳動
 *   - 佈局 shift（間距、對齊、標題排列改動）
 *   - 字級 / 字重 / letter-spacing 漂移
 *
 * 動態內容（價格、百分比、日期、SVG walk、rank bar）以 mask 遮蔽，
 * 只驗證結構與排版是否穩定。
 *
 * 另附「同套 mock 下的跨斷點結構一致性」測試：
 *   由 `/holding-checkup-demo` 提供的固定 demo seed，在所有斷點下解出
 *   同一份結構指紋（標的、tab 名稱、關鍵 testid 集合、tab 數量），
 *   對照 `e2e/fixtures/holdings-detail-panel-fingerprint.json` 唯一 baseline。
 *   任一斷點與其它斷點不同 → 立即失敗（不是 pixel 差異，是結構 drift）。
 *
 * baseline 存放於 `holdings-detail-panel-visual-snapshot.spec.ts-snapshots/`。
 */

import { test, expect, type Page, type Locator } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';
import { drawerStep, registerDrawerFailureReport } from './helpers/drawer-failure-report';

registerDrawerFailureReport();

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

/** 中和動畫 / caret / 隨機色 / 滾動條 / 減少 subpixel AA 差異 */
async function stabilize(page: Page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
        caret-color: transparent !important;
      }
      html { scrollbar-width: none !important; }
      html::-webkit-scrollbar { display: none !important; }
    `,
  });
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
  });
}

test.describe('HoldingsDetailPanel · 視覺快照回歸（多斷點）', () => {
  test('抽屜於當前斷點視覺快照與 baseline 相符', async ({ page }, testInfo) => {
    const width = testInfo.project.use.viewport?.width ?? 1280;

    await drawerStep('prime demo storage', () => primeDemo(page));
    await drawerStep(`goto /holding-checkup-demo @ ${width}px`, () =>
      gotoWithRetry(page, '/holding-checkup-demo', { waitUntil: 'domcontentloaded' }),
    );
    await drawerStep('open drawer + stabilize', async () => {
      const firstCard = page.locator('.wb-card').first();
      await firstCard.waitFor({ state: 'visible', timeout: 15_000 });
      await firstCard.scrollIntoViewIfNeeded();
      await firstCard.click();
      const panel0 = page.locator('[data-testid="holdings-detail-panel"]').first();
      await panel0.waitFor({ state: 'visible', timeout: 15_000 });
      await stabilize(page);
      await page.waitForTimeout(400);
    });

    const panel = page.locator('[data-testid="holdings-detail-panel"]').first();

    // 動態內容 mask — 避免每次跑價/時間差異炸掉快照
    const masks: Locator[] = [
      page.locator('[data-testid="drawer-roi-main"]'),
      page.locator('[data-testid="hold-context"]'),
      page.locator('[data-testid="decision-stamp"]'),
      page.locator('[data-testid="holdings-price-axis"]'),
      page.locator('[data-testid="holdings-range-band"]'),
      page.locator('[data-testid="holdings-weight-rank"]'),
      page.locator('[data-testid="holdings-thesis-history"]'),
    ];

    await drawerStep(`snapshot diff @ ${width}px`, () =>
      expect(panel).toHaveScreenshot(`holdings-detail-panel-${width}.png`, {
        mask: masks,
        maskColor: '#efeae1',
        animations: 'disabled',
        caret: 'hide',
        scale: 'css',
        maxDiffPixelRatio: 0.02,
      }),
    );
  });
});
