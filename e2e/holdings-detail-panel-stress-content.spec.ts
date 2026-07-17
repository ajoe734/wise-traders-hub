/**
 * E2E · HoldingsDetailPanel 抽屜 · 極端內容壓力測試
 *
 * 針對「內容資料量」而非「筆數」的三個維度加壓，驗證幾何守門不因下列變化跳動：
 *   1. long-title  — 個股名稱 60 字、決策 note 200 字單行、事件標題 120 字
 *   2. multiline   — 決策 note 20 行 + thesis 描述多段換行
 *   3. mega-list   — events / targetPriceHistory / thesisTracking 各 500 筆
 *   4. all         — 上述三者同時開啟（最終壓力）
 *
 * 每個 stress preset × 4 viewport (320 / 390 / 768 / 1280) × 3 scroll position
 * 皆執行純幾何 overflow 守門（tolerance=1.5px）+ 字級 ≤ 22px。
 *
 * 失敗時以 drawer-overflow-annotate 產出標註截圖與 JSON。
 */
import { test, expect, type Page, type Locator } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';
import { drawerStep, registerDrawerFailureReport } from './helpers/drawer-failure-report';
import { annotateOverflowAndAttach, mergeAuditFindings } from './helpers/drawer-overflow-annotate';
import {
  assertOverflowHardCap,
  findingsMaxOverflow,
  OVERFLOW_TOLERANCE_PX,
  VolatilityTracker,
} from './helpers/drawer-rwd-thresholds';

registerDrawerFailureReport();

const MAX_FONT_PX = 22;
const STRESS_PRESETS = ['long-title', 'multiline', 'mega-list', 'all'] as const;
type Preset = (typeof STRESS_PRESETS)[number];

type AuditResult = {
  badFonts: Array<{ tag: string; text: string; fontSize: number }>;
  badBoxes: Array<{ tag: string; text: string; left: number; right: number; top: number; bottom: number; rootLeft: number; rootRight: number; overflow: number }>;
  badTextNodes: Array<{ text: string; left: number; right: number; top: number; bottom: number; rootLeft: number; rootRight: number; overflow: number }>;
};

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
  }, { maxFontPx: MAX_FONT_PX, tolerance: OVERFLOW_TOLERANCE_PX }) as Promise<AuditResult>;
}

async function scrollPanelTo(page: Page, pos: 'top' | 'mid' | 'bottom') {
  return page.evaluate((position) => {
    const doc = document.scrollingElement || document.documentElement;
    const maxScroll = doc.scrollHeight - doc.clientHeight;
    const target = position === 'top' ? 0 : position === 'mid' ? Math.floor(maxScroll / 2) : maxScroll;
    doc.scrollTop = target;
    return { scrollHeight: doc.scrollHeight, clientHeight: doc.clientHeight, scrollTop: doc.scrollTop };
  }, pos);
}

test.describe('HoldingsDetailPanel · 極端內容壓力（長標題 / 多行摘要 / 大量列表）', () => {
  for (const preset of STRESS_PRESETS) {
    test(`stress=${preset} · 幾何守門不因內容加壓而跳動`, async ({ page }, testInfo) => {
      const width = testInfo.project.use.viewport?.width ?? 1280;
      const widthMode = width >= 640 ? 'desktop' : 'mobile';
      // count 固定 10：主要壓力來自 stress 內容變化；mega-list 會 override 列表長度到 500
      const count = 10;

      await drawerStep(`goto harness stress=${preset} width=${widthMode} vp=${width}`, () =>
        gotoWithRetry(
          page,
          `/e2e/holdings-detail-panel-volume?count=${count}&width=${widthMode}&stress=${preset}`,
          { waitUntil: 'domcontentloaded' },
        ),
      );

      const panel = page.locator('[data-testid="holdings-detail-panel"]').first();
      await panel.waitFor({ state: 'visible', timeout: 15_000 });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(250);

      // 驗 harness 有真的收到 stress 參數
      const meta = await panel.evaluate((el) => ({
        stress: el.getAttribute('data-volume-stress'),
        listCount: el.getAttribute('data-volume-list-count'),
      }));
      expect(meta.stress, `harness 未套用 stress=${preset}`).toBe(preset);

      // 1. 文件層無水平溢出
      const viewport = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(
        viewport.scrollWidth,
        `[stress=${preset} vp=${width}] document scrollWidth(${viewport.scrollWidth}) > clientWidth(${viewport.clientWidth})`,
      ).toBeLessThanOrEqual(viewport.clientWidth + 1);

      // 2. 三個滾動位置（top / mid / bottom）分別 audit
      for (const pos of ['top', 'mid', 'bottom'] as const) {
        const scrollInfo = await drawerStep(`scroll → ${pos}`, () => scrollPanelTo(page, pos));
        await page.waitForTimeout(120);
        const audit = await drawerStep(`audit @ ${pos}`, () => auditPanel(panel));

        const findings = mergeAuditFindings(audit);
        if (findings.length > 0) {
          await annotateOverflowAndAttach(
            page, panel, findings, testInfo,
            `stress-${preset}-vp${width}-${pos}`,
          );
        }

        const tag = `[stress=${preset} vp=${width} ${pos} scroll=${scrollInfo.scrollTop}/${scrollInfo.scrollHeight} listCount=${meta.listCount}]`;
        expect(audit.badFonts, `${tag} font-size > ${MAX_FONT_PX}px`).toEqual([]);
        expect(audit.badBoxes, `${tag} element overflow (tol=${OVERFLOW_TOLERANCE_PX}px)`).toEqual([]);
        expect(audit.badTextNodes, `${tag} text node overflow (tol=${OVERFLOW_TOLERANCE_PX}px)`).toEqual([]);
      }
    });
  }
});
