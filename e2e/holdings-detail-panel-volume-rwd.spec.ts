/**
 * E2E · HoldingsDetailPanel 抽屜 · 多資料量 RWD 溢出守門
 *
 * 進入 /e2e/holdings-detail-panel-volume?count=N&width=mobile|desktop harness，
 * 在 count ∈ {1, 10, 50} × viewport ∈ {320, 390, 768, 1280} 全 12 種組合下驗證：
 *   1. document scrollWidth <= clientWidth + 1（無水平捲軸）
 *   2. panel 內所有 layout 節點與 text-node 幾何皆在 panel 內（tolerance 1.5px）
 *   3. 所有 layout 節點 computed fontSize ≤ 22px
 *
 * 判定路徑與 rwd-integrity spec 對齊：純幾何、不依賴 aria/Radix visually-hidden。
 */
import { test, expect, type Page } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';
import { drawerStep, registerDrawerFailureReport } from './helpers/drawer-failure-report';
import { annotateOverflowAndAttach, mergeAuditFindings } from './helpers/drawer-overflow-annotate';

registerDrawerFailureReport();

const MAX_FONT_PX = 22;
const OVERFLOW_TOLERANCE_PX = 1.5;
const COUNTS = [1, 10, 50] as const;

async function auditPanel(page: Page) {
  const panel = page.locator('[data-testid="holdings-detail-panel"]').first();
  await panel.waitFor({ state: 'visible', timeout: 15_000 });
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(200);

  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));

  const audit = await panel.evaluate((root, args) => {
    const { maxFontPx, tolerance } = args;
    const rootBox = root.getBoundingClientRect();
    const badFonts: Array<{ tag: string; text: string; fontSize: number }> = [];
    const badBoxes: Array<{ tag: string; text: string; left: number; right: number; top: number; bottom: number; rootLeft: number; rootRight: number; overflow: number }> = [];
    const badTextNodes: Array<{ text: string; left: number; right: number; top: number; bottom: number; rootLeft: number; rootRight: number; overflow: number }> = [];

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
    const overflowAmount = (rect: { left: number; right: number }) =>
      Math.max(rootBox.left - rect.left, rect.right - rootBox.right, 0);

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
      if (text && overflow > tolerance) badBoxes.push({
        tag: el.tagName.toLowerCase(), text,
        left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        rootLeft: rootBox.left, rootRight: rootBox.right,
        overflow,
      });
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
            overflow,
          });
        }
      }
    }

    return { badFonts, badBoxes, badTextNodes };
  }, { maxFontPx: MAX_FONT_PX, tolerance: OVERFLOW_TOLERANCE_PX });

  return { viewport, audit };
}

test.describe('HoldingsDetailPanel · 多資料量 RWD 溢出守門', () => {
  for (const count of COUNTS) {
    test(`count=${count} · 抽屜與內容不因清單筆數溢出`, async ({ page }, testInfo) => {
      const width = testInfo.project.use.viewport?.width ?? 1280;
      const widthMode = width >= 640 ? 'desktop' : 'mobile';

      await drawerStep(`goto harness count=${count} width=${widthMode} viewport=${width}px`, () =>
        gotoWithRetry(
          page,
          `/e2e/holdings-detail-panel-volume?count=${count}&width=${widthMode}`,
          { waitUntil: 'domcontentloaded' },
        ),
      );

      const { viewport, audit } = await drawerStep(`audit geometry (count=${count})`, () => auditPanel(page));

      expect(
        viewport.scrollWidth,
        `[count=${count} viewport=${width}px] document horizontal scroll: scrollWidth(${viewport.scrollWidth}) > clientWidth(${viewport.clientWidth})`,
      ).toBeLessThanOrEqual(viewport.clientWidth + 1);

      expect(
        audit.badFonts,
        `[count=${count} viewport=${width}px] font-size > ${MAX_FONT_PX}px`,
      ).toEqual([]);
      expect(
        audit.badBoxes,
        `[count=${count} viewport=${width}px] element overflows panel (tolerance=${OVERFLOW_TOLERANCE_PX}px)`,
      ).toEqual([]);
      expect(
        audit.badTextNodes,
        `[count=${count} viewport=${width}px] text node overflows panel (tolerance=${OVERFLOW_TOLERANCE_PX}px)`,
      ).toEqual([]);
    });
  }
});
