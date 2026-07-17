/**
 * E2E 回歸 — HoldingsDetailPanel 抽屜整體 RWD / legacy 清除守門
 *
 * 覆蓋：320 / 375 / 390 / 414 / 560 / 768 / 863 / 1024 / 1280
 * 目的：避免 legacy FreeCheckup drawer（返回列表 / 來自：/ DECISION / TARGETS / tab bar）再混回來，
 *      並確保新版抽屜所有主要文字與 panel 本體不水平溢出，字級不超過 22px。
 */
import { test, expect, type Page } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';
import { drawerStep, registerDrawerFailureReport } from './helpers/drawer-failure-report';
import { annotateOverflowAndAttach, mergeAuditFindings } from './helpers/drawer-overflow-annotate';
import { assertOverflowHardCap } from './helpers/drawer-rwd-thresholds';

registerDrawerFailureReport();

const MAX_FONT_PX = 22;
const LEGACY_TEXTS = [
  { text: '返回列表', exact: false },
  { text: '來自：', exact: false },
  { text: 'DECISION', exact: true },
  { text: 'TARGETS · 分析師目標價', exact: false },
] as const;

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

test.describe('HoldingsDetailPanel · RWD integrity + legacy drawer guard', () => {
  test('新版抽屜單一路徑、無 legacy DOM、無水平溢出、全域字級 ≤ 22px', async ({ page }, testInfo) => {
    const width = testInfo.project.use.viewport?.width ?? 1280;

    await drawerStep('prime demo storage', () => primeDemo(page));
    await drawerStep(`goto /holding-checkup-demo @ ${width}px`, () =>
      gotoWithRetry(page, '/holding-checkup-demo', { waitUntil: 'domcontentloaded' }),
    );

    await drawerStep('click first card + wait drawer visible + fonts ready', async () => {
      const firstCard = page.locator('.wb-card').first();
      await firstCard.waitFor({ state: 'visible', timeout: 15_000 });
      await firstCard.scrollIntoViewIfNeeded();
      await firstCard.click();
      const panel = page.locator('[data-testid="holdings-detail-panel"]').first();
      await panel.waitFor({ state: 'visible', timeout: 15_000 });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(250);
    });

    const panel = page.locator('[data-testid="holdings-detail-panel"]').first();

    await expect(page.locator('[data-testid="holdings-detail-panel"]')).toHaveCount(1);
    await expect(page.locator('.holding-drawer-content')).toHaveCount(0);
    await expect(page.locator('.holding-drawer-tabs')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /^摘要$/ })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /^教學$/ })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /^風險$/ })).toHaveCount(0);

    for (const { text, exact } of LEGACY_TEXTS) {
      await expect(
        page.getByText(text, { exact }),
        `[${width}px] legacy drawer text should not exist: ${text}`,
      ).toHaveCount(0);
    }

    const viewport = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(
      viewport.scrollWidth,
      `[${width}px] document horizontal scroll: scrollWidth(${viewport.scrollWidth}) > clientWidth(${viewport.clientWidth})`,
    ).toBeLessThanOrEqual(viewport.clientWidth + 1);

    const panelBox = await panel.boundingBox();
    expect(panelBox, `[${width}px] panel bounding box should exist`).not.toBeNull();
    if (panelBox) {
      expect(panelBox.x, `[${width}px] panel left overflow`).toBeGreaterThanOrEqual(-0.5);
      expect(panelBox.x + panelBox.width, `[${width}px] panel right overflow`).toBeLessThanOrEqual(viewport.clientWidth + 0.5);
    }

    // 溢出判定改為「純幾何」路徑：
    //   1. 不再依賴 aria-hidden / Radix visually-hidden / sr-only 判讀（Radix Dialog
    //      的 VisuallyHidden 節點會誤導判定；aria-hidden 也不代表視覺不佔位）。
    //   2. 排除條件僅限「布局上真的沒佔位」：display:none、visibility:hidden、
    //      getClientRects() 為空、或 rect 面積 = 0。
    //   3. 溢出比對統一使用 boundingClientRect + 明確像素容差 `OVERFLOW_TOLERANCE_PX`，
    //      吸收 sub-pixel rounding / transform AA / scrollbar gutter 誤差。
    const OVERFLOW_TOLERANCE_PX = 1.5;
    const audit = await panel.evaluate((root, args) => {
      const { maxFontPx, tolerance } = args;
      const rootBox = root.getBoundingClientRect();
      const badFonts: Array<{ tag: string; text: string; fontSize: number }> = [];
      const badBoxes: Array<{ tag: string; text: string; left: number; right: number; top: number; bottom: number; rootLeft: number; rootRight: number; overflow: number }> = [];
      const badTextNodes: Array<{ text: string; left: number; right: number; top: number; bottom: number; rootLeft: number; rootRight: number; overflow: number }> = [];

      /**
       * 幾何佔位判定 — 只問：這個節點在版面上是否實際佔位並可見？
       * 完全不看 aria-hidden、data-radix-visually-hidden 這類 ARIA 標記。
       * 但仍會排除「純視覺尺寸為 0」的節點（CSS clip / clip-path 收成 0、
       *   或 boundingRect ≤ 1px 的 sr-only trick）— 這是幾何/視覺尺寸判定，
       *   與 ARIA 判讀無關，避免 shadcn `<span class="sr-only">Close</span>`
       *   類節點被誤報為溢出。
       */
      const SUBPIXEL = 1;
      const isClippedToZero = (cs: CSSStyleDeclaration): boolean => {
        if (cs.clip && cs.clip !== 'auto' && cs.clip.replace(/\s/g, '').includes('rect(0px,0px,0px,0px)')) return true;
        if (cs.clipPath && cs.clipPath !== 'none' && cs.clipPath.replace(/\s/g, '') === 'inset(50%)') return true;
        return false;
      };
      const hasLayout = (el: Element): boolean => {
        const cs = window.getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        if (isClippedToZero(cs)) return false;
        const rects = (el as HTMLElement).getClientRects?.();
        if (!rects || rects.length === 0) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width <= SUBPIXEL || rect.height <= SUBPIXEL) return false;
        // 祖先鏈若被 clip 成 0 / 收成 1px（sr-only 慣用），本節點視覺上也不佔位
        let cur: Element | null = el.parentElement;
        while (cur && cur !== root) {
          const curCs = window.getComputedStyle(cur);
          if (isClippedToZero(curCs)) return false;
          const curRect = cur.getBoundingClientRect();
          if (curCs.overflow !== 'visible' && (curRect.width <= SUBPIXEL || curRect.height <= SUBPIXEL)) return false;
          cur = cur.parentElement;
        }
        return true;
      };

      const overflowAmount = (rect: { left: number; right: number }) => {
        const leftOver = rootBox.left - rect.left;
        const rightOver = rect.right - rootBox.right;
        return Math.max(leftOver, rightOver, 0);
      };

      const elements = Array.from(root.querySelectorAll('*')).filter(hasLayout);
      for (const el of elements) {
        const cs = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        const fontSize = Number.parseFloat(cs.fontSize || '0');
        if (Number.isFinite(fontSize) && fontSize > maxFontPx + 0.01) {
          badFonts.push({ tag: el.tagName.toLowerCase(), text, fontSize });
        }
        const overflow = overflowAmount(rect);
        if (text && overflow > tolerance) {
          badBoxes.push({
            tag: el.tagName.toLowerCase(), text,
            left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
            rootLeft: rootBox.left, rootRight: rootBox.right,
            overflow,
          });
        }
      }

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const value = (node.textContent || '').replace(/\s+/g, '').trim();
          if (!value) return NodeFilter.FILTER_REJECT;
          const parent = node.parentElement;
          if (!parent || !hasLayout(parent)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        const range = document.createRange();
        range.selectNodeContents(node);
        const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
        range.detach();
        for (const rect of rects) {
          const overflow = overflowAmount(rect);
          if (overflow > tolerance) {
            badTextNodes.push({
              text: (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
              left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
              rootLeft: rootBox.left, rootRight: rootBox.right,
              overflow,
            });
          }
        }
      }

      return { badFonts, badBoxes, badTextNodes };
    }, { maxFontPx: MAX_FONT_PX, tolerance: OVERFLOW_TOLERANCE_PX });

    const findings = mergeAuditFindings(audit);
    if (findings.length > 0) {
      await annotateOverflowAndAttach(page, panel, findings, testInfo, `rwd-${width}`);
    }

    expect(audit.badFonts, `[${width}px] font-size > ${MAX_FONT_PX}px`).toEqual([]);
    expect(
      audit.badBoxes,
      `[${width}px] element overflows panel (tolerance=${OVERFLOW_TOLERANCE_PX}px, geometry-only)`,
    ).toEqual([]);
    expect(
      audit.badTextNodes,
      `[${width}px] text node overflows panel (tolerance=${OVERFLOW_TOLERANCE_PX}px, geometry-only)`,
    ).toEqual([]);
  });
});