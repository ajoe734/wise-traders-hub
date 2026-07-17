/**
 * E2E 回歸 — HoldingsDetailPanel 抽屜 · 極端視窗 × 旋轉 × 滾動位置 幾何守門
 *
 * 目的（補齊 rwd-integrity 的覆蓋盲點）：
 *   1. 極窄（280 折疊機）/ 極寬（1920, 2560）/ 超短（keyboard-open sim: h=420）
 *      / 超高（tall: 320×1200）/ 平板 portrait+landscape / 手機 landscape 旋轉
 *   2. 抽屜開啟後在多個「滾動位置」（top / mid / bottom）分別做幾何守門，
 *      避免只驗證首屏、下方 section（Trade History / Thesis / TargetPrice）漏檢
 *   3. 沿用純幾何 boundingClientRect + OVERFLOW_TOLERANCE_PX 容差，
 *      驗證極端寬高比下 layout tolerance 仍穩定不誤報
 *
 * 覆蓋斷點（見 playwright.config.ts 的 `holdings-detail-rwd-extreme-*` projects）：
 *   portrait ultra-narrow : 280×653
 *   portrait iphone       : 360×640, 430×932
 *   landscape rotation    : 667×375, 812×375, 844×390, 896×414, 932×430
 *   keyboard-open short   : 390×420, 414×500
 *   tall narrow           : 320×1200
 *   tablet portrait/land  : 820×1180, 1180×820
 *   ultra-wide desktop    : 1440×900, 1920×1080, 2560×1080
 */
import { test, expect, type Page, type Locator } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';
import { drawerStep, registerDrawerFailureReport } from './helpers/drawer-failure-report';

registerDrawerFailureReport();

const MAX_FONT_PX = 22;
const OVERFLOW_TOLERANCE_PX = 1.5;

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

type AuditResult = {
  badFonts: Array<{ tag: string; text: string; fontSize: number }>;
  badBoxes: Array<{ tag: string; text: string; left: number; right: number; rootLeft: number; rootRight: number; overflow: number }>;
  badTextNodes: Array<{ text: string; left: number; right: number; rootLeft: number; rootRight: number; overflow: number }>;
};

/**
 * 純幾何守門（與 rwd-integrity 完全同一份判定，避免行為漂移）
 *  - hasLayout：display / visibility / clip / clip-path / getClientRects / rect ≥ 1px + 祖先鏈 clip
 *  - overflow：以 root(panel).getBoundingClientRect() 為界，容差 OVERFLOW_TOLERANCE_PX
 */
async function auditPanel(panel: Locator): Promise<AuditResult> {
  return panel.evaluate((root, args) => {
    const { maxFontPx, tolerance } = args;
    const rootBox = root.getBoundingClientRect();
    const badFonts: AuditResult['badFonts'] = [];
    const badBoxes: AuditResult['badBoxes'] = [];
    const badTextNodes: AuditResult['badTextNodes'] = [];

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
    const overflowAmount = (rect: { left: number; right: number }) => {
      const leftOver = rootBox.left - rect.left;
      const rightOver = rect.right - rootBox.right;
      return Math.max(leftOver, rightOver, 0);
    };

    const elements = Array.from(root.querySelectorAll('*')).filter(hasLayout) as unknown as Element[];
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
          left: rect.left, right: rect.right,
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
            left: rect.left, right: rect.right,
            rootLeft: rootBox.left, rootRight: rootBox.right,
            overflow,
          });
        }
      }
    }

    return { badFonts, badBoxes, badTextNodes };
  }, { maxFontPx: MAX_FONT_PX, tolerance: OVERFLOW_TOLERANCE_PX }) as Promise<AuditResult>;
}

/**
 * 在抽屜「可滾動容器」內把 scrollTop 設為指定位置（0 / mid / bottom）
 * 若抽屜本體非滾動容器，退回 window scroll
 */
async function scrollPanelTo(panel: Locator, position: 'top' | 'mid' | 'bottom'): Promise<{ scrollHeight: number; clientHeight: number; scrollTop: number }> {
  return panel.evaluate((root, pos) => {
    const findScroller = (el: HTMLElement): HTMLElement => {
      let cur: HTMLElement | null = el;
      while (cur) {
        const cs = window.getComputedStyle(cur);
        if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && cur.scrollHeight > cur.clientHeight + 1) return cur;
        cur = cur.firstElementChild as HTMLElement | null;
        // 只 dive 幾層即可
        if (!cur) break;
      }
      // fallback：找 panel 底下 scrollHeight > clientHeight 的第一個
      const candidates = Array.from(el.querySelectorAll<HTMLElement>('*'));
      const found = candidates.find((c) => {
        const cs = window.getComputedStyle(c);
        return (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && c.scrollHeight > c.clientHeight + 1;
      });
      return found ?? el;
    };
    const scroller = findScroller(root as HTMLElement);
    const target = pos === 'top' ? 0 : pos === 'mid' ? Math.floor((scroller.scrollHeight - scroller.clientHeight) / 2) : scroller.scrollHeight;
    scroller.scrollTop = target;
    return { scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight, scrollTop: scroller.scrollTop };
  }, position);
}

test.describe('HoldingsDetailPanel · RWD extreme geometry guard', () => {
  test('極端視窗 × 旋轉 × 滾動位置 下抽屜無溢出、字級 ≤ 22px', async ({ page }, testInfo) => {
    const vp = testInfo.project.use.viewport;
    const label = vp ? `${vp.width}x${vp.height}` : 'unknown';

    await drawerStep('prime demo storage', () => primeDemo(page));
    await drawerStep(`goto /holding-checkup-demo @ ${label}`, () =>
      gotoWithRetry(page, '/holding-checkup-demo', { waitUntil: 'domcontentloaded' }),
    );

    await drawerStep('open first drawer + fonts ready', async () => {
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

    // 1. 文件層級無水平溢出（含 scrollbar gutter 容差）
    const viewport = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(
      viewport.scrollWidth,
      `[${label}] document horizontal scroll: scrollWidth(${viewport.scrollWidth}) > clientWidth(${viewport.clientWidth})`,
    ).toBeLessThanOrEqual(viewport.clientWidth + 1);

    // 2. panel bounding box 不外溢視窗
    const panelBox = await panel.boundingBox();
    expect(panelBox, `[${label}] panel bounding box should exist`).not.toBeNull();
    if (panelBox) {
      expect(panelBox.x, `[${label}] panel left overflow`).toBeGreaterThanOrEqual(-0.5);
      expect(panelBox.x + panelBox.width, `[${label}] panel right overflow`).toBeLessThanOrEqual(viewport.clientWidth + 0.5);
    }

    // 3. 三個滾動位置分別做幾何守門（頂 / 中 / 底），避免只驗首屏漏檢下方 sections
    const positions = ['top', 'mid', 'bottom'] as const;
    for (const pos of positions) {
      const scrollInfo = await drawerStep(`scroll panel → ${pos}`, () => scrollPanelTo(panel, pos));
      await page.waitForTimeout(120);
      const audit = await drawerStep(`geometry audit @ ${pos}`, () => auditPanel(panel));

      expect(
        audit.badFonts,
        `[${label} · ${pos} scroll=${scrollInfo.scrollTop}/${scrollInfo.scrollHeight}] font-size > ${MAX_FONT_PX}px`,
      ).toEqual([]);
      expect(
        audit.badBoxes,
        `[${label} · ${pos} scroll=${scrollInfo.scrollTop}/${scrollInfo.scrollHeight}] element overflow (tol=${OVERFLOW_TOLERANCE_PX}px)`,
      ).toEqual([]);
      expect(
        audit.badTextNodes,
        `[${label} · ${pos} scroll=${scrollInfo.scrollTop}/${scrollInfo.scrollHeight}] text node overflow (tol=${OVERFLOW_TOLERANCE_PX}px)`,
      ).toEqual([]);
    }
  });
});
