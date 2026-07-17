/**
 * E2E · HoldingsDetailPanel 抽屜「垂直捲動 → 水平溢出」回歸守門
 *
 * 抓的是這類 bug：
 *   - 抽屜打開時第一屏 OK，但一往下捲，底部 section（sticky footer / 圖表 /
 *     長字元 / 動態載入的表格）出現水平溢出、把 panel 撐爆、document 觸發水平 scrollbar
 *   - 或反過來：滾到底之後某個節點 hover / lazy-mount 才顯示，用「只驗首屏」的 spec 抓不到
 *
 * 覆蓋策略（不准偷懶）：
 *   A. 三種真實捲動方式，都得零溢出、零守門觸發：
 *        1) scrollTop 直接設值（模擬程式化 scroll）
 *        2) mouse wheel events（模擬滑鼠滾輪 / trackpad）
 *        3) 鍵盤 PageDown / End / Home（模擬鍵盤操作）
 *   B. 每種方式在 0% / 20% / 40% / 60% / 80% / 100% 六個段落 audit
 *   C. 捲到底再捲回頂端，額外檢查「回程」也不會殘留出界節點（layout thrash 常見回歸）
 *   D. 每一步都做四層守門：
 *        - document.scrollWidth ≤ clientWidth + 1（無水平 scrollbar）
 *        - panel.boundingBox.right ≤ viewport.right + 0.5（抽屜本體未外溢）
 *        - 純幾何 element / text-node overflow 全數為空（tolerance = OVERFLOW_TOLERANCE_PX）
 *        - CI-strict：任何 finding.overflow ≤ OVERFLOW_HARD_CAP_PX
 *   E. VolatilityTracker 在同一 method 內比對 6 個 scroll 段的 maxOverflow 極差
 *
 * harness：/e2e/holdings-detail-panel-volume?count=50&width=... — 已保證抽屜內容夠長需要捲動
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
const SCROLL_FRACTIONS = [0, 0.2, 0.4, 0.6, 0.8, 1] as const;

type AuditResult = {
  badFonts: Array<{ tag: string; text: string; fontSize: number }>;
  badBoxes: Array<{ tag: string; text: string; left: number; right: number; top: number; bottom: number; rootLeft: number; rootRight: number; overflow: number }>;
  badTextNodes: Array<{ text: string; left: number; right: number; top: number; bottom: number; rootLeft: number; rootRight: number; overflow: number }>;
};

/** 純幾何 audit — 與 extreme / volume / stress spec 對齊，靠 boundingClientRect 判斷 */
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

/**
 * 找抽屜內部真正的 scroll container
 * 優先抽屜本身；不是的話往下找第一個 overflowY:auto|scroll 且 scrollHeight > clientHeight 的節點；
 * 都找不到就 fallback 到 document.scrollingElement，並回傳 scroller 的 DOM handle 資訊
 */
async function measureScroller(panel: Locator) {
  return panel.evaluate((root) => {
    const isScrollable = (el: Element): boolean => {
      const cs = window.getComputedStyle(el);
      return (cs.overflowY === 'auto' || cs.overflowY === 'scroll') &&
        (el as HTMLElement).scrollHeight > (el as HTMLElement).clientHeight + 1;
    };
    let scroller: HTMLElement = root as HTMLElement;
    if (!isScrollable(scroller)) {
      const found = Array.from(root.querySelectorAll<HTMLElement>('*')).find(isScrollable);
      scroller = found ?? (document.scrollingElement as HTMLElement) ?? (document.documentElement as HTMLElement);
    }
    const rect = scroller.getBoundingClientRect();
    return {
      isDocument: scroller === document.scrollingElement || scroller === document.documentElement,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      scrollTop: scroller.scrollTop,
      maxScroll: Math.max(0, scroller.scrollHeight - scroller.clientHeight),
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
    };
  });
}

/** 用 scrollTop 設值直接跳到指定位置（fraction ∈ [0,1]） */
async function programmaticScrollTo(panel: Locator, fraction: number): Promise<number> {
  return panel.evaluate((root, frac) => {
    const isScrollable = (el: Element): boolean => {
      const cs = window.getComputedStyle(el);
      return (cs.overflowY === 'auto' || cs.overflowY === 'scroll') &&
        (el as HTMLElement).scrollHeight > (el as HTMLElement).clientHeight + 1;
    };
    let scroller: HTMLElement = root as HTMLElement;
    if (!isScrollable(scroller)) {
      const found = Array.from(root.querySelectorAll<HTMLElement>('*')).find(isScrollable);
      scroller = found ?? (document.scrollingElement as HTMLElement) ?? (document.documentElement as HTMLElement);
    }
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    scroller.scrollTop = Math.floor(max * frac);
    return scroller.scrollTop;
  }, fraction);
}

/** 從 top 用 mouse wheel 分段捲到指定 fraction */
async function wheelScrollTo(page: Page, panel: Locator, fraction: number): Promise<number> {
  await programmaticScrollTo(panel, 0);
  const info = await measureScroller(panel);
  const targetTop = Math.floor(info.maxScroll * fraction);
  if (targetTop <= 0) return 0;
  await page.mouse.move(info.centerX, info.centerY);
  const stepPx = 120;
  let dispatched = 0;
  while (dispatched < targetTop) {
    const delta = Math.min(stepPx, targetTop - dispatched);
    await page.mouse.wheel(0, delta);
    dispatched += delta;
    await page.waitForTimeout(15);
  }
  await page.waitForTimeout(60);
  const after = await measureScroller(panel);
  return after.scrollTop;
}

/** 用鍵盤 Home / End / PageDown 捲動 */
async function keyboardScrollTo(page: Page, panel: Locator, fraction: number): Promise<number> {
  await panel.focus().catch(() => {});
  // 先跳到頂端以固定起點
  await page.keyboard.press('Home');
  await page.waitForTimeout(60);
  if (fraction <= 0) return (await measureScroller(panel)).scrollTop;
  if (fraction >= 1) {
    await page.keyboard.press('End');
    await page.waitForTimeout(80);
    return (await measureScroller(panel)).scrollTop;
  }
  const info = await measureScroller(panel);
  const targetTop = Math.floor(info.maxScroll * fraction);
  // 用 PageDown 逼近，每次約 clientHeight * 0.9
  let scrollTop = info.scrollTop;
  let safety = 0;
  while (scrollTop < targetTop && safety < 40) {
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(30);
    scrollTop = (await measureScroller(panel)).scrollTop;
    safety += 1;
  }
  // PageDown 通常會多按一段；再用 programmatic 微調到 target 附近，保留「已經用鍵盤觸發過」的 layout 副作用
  await programmaticScrollTo(panel, fraction);
  await page.waitForTimeout(40);
  return (await measureScroller(panel)).scrollTop;
}

type ScrollMethod = 'programmatic' | 'wheel' | 'keyboard';

async function runScrollMethod(
  page: Page,
  panel: Locator,
  method: ScrollMethod,
  testInfo: import('@playwright/test').TestInfo,
  vpLabel: string,
) {
  const tracker = new VolatilityTracker(`scroll-overflow ${vpLabel} · ${method}`);

  // 每個 method 開始前重置到頂端
  await programmaticScrollTo(panel, 0);
  await page.waitForTimeout(100);

  // 捲程 + 回程（0→100→0）都要 audit — 回程是為抓 layout thrash 殘留
  const forwardFractions = SCROLL_FRACTIONS;
  const backwardFractions = [...SCROLL_FRACTIONS].reverse().slice(1); // 去掉重複的 1
  const legs: Array<{ tag: 'fwd' | 'bwd'; fraction: number }> = [
    ...forwardFractions.map((f) => ({ tag: 'fwd' as const, fraction: f })),
    ...backwardFractions.map((f) => ({ tag: 'bwd' as const, fraction: f })),
  ];

  for (const { tag, fraction } of legs) {
    const label = `${vpLabel}-${method}-${tag}-${Math.round(fraction * 100)}pct`;

    let actualTop = 0;
    await drawerStep(`scroll[${method}] → ${tag} ${Math.round(fraction * 100)}%`, async () => {
      if (method === 'programmatic') actualTop = await programmaticScrollTo(panel, fraction);
      else if (method === 'wheel') actualTop = await wheelScrollTo(page, panel, fraction);
      else actualTop = await keyboardScrollTo(page, panel, fraction);
    });
    await page.waitForTimeout(80);

    // 1) 文件層無水平 scrollbar
    const viewport = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(
      viewport.scrollWidth,
      `[${label} scrollTop=${actualTop}] document scrollWidth(${viewport.scrollWidth}) > clientWidth(${viewport.clientWidth})`,
    ).toBeLessThanOrEqual(viewport.clientWidth + 1);

    // 2) panel bounding box 未外溢視窗
    const panelBox = await panel.boundingBox();
    expect(panelBox, `[${label}] panel bounding box should exist`).not.toBeNull();
    if (panelBox) {
      expect(panelBox.x, `[${label}] panel left overflow`).toBeGreaterThanOrEqual(-0.5);
      expect(
        panelBox.x + panelBox.width,
        `[${label}] panel right overflow (right=${(panelBox.x + panelBox.width).toFixed(2)})`,
      ).toBeLessThanOrEqual(viewport.clientWidth + 0.5);
    }

    // 3) 幾何 audit — 任何 overflow 都要標註 + fail
    const audit = await auditPanel(panel);
    const findings = mergeAuditFindings(audit);
    if (findings.length > 0) {
      await annotateOverflowAndAttach(page, panel, findings, testInfo, label);
    }
    tracker.record(`${tag}-${Math.round(fraction * 100)}`, findingsMaxOverflow(findings));

    expect(
      audit.badFonts,
      `[${label} scrollTop=${actualTop}] font-size > ${MAX_FONT_PX}px`,
    ).toEqual([]);
    expect(
      audit.badBoxes,
      `[${label} scrollTop=${actualTop}] element overflow (tol=${OVERFLOW_TOLERANCE_PX}px) — vertical scroll must not re-trigger overflow guard`,
    ).toEqual([]);
    expect(
      audit.badTextNodes,
      `[${label} scrollTop=${actualTop}] text node overflow (tol=${OVERFLOW_TOLERANCE_PX}px) — vertical scroll must not re-trigger overflow guard`,
    ).toEqual([]);

    // 4) CI-strict：單一 overflow 硬上限
    assertOverflowHardCap(findings, label);
  }

  // 5) 波動守門：同一 method 下所有 scroll 段的 maxOverflow 極差不得跳動
  tracker.assertRange();
}

test.describe('HoldingsDetailPanel · 內部垂直捲動不得觸發水平溢出', () => {
  test('三種捲動方式 × 6 段位置 × 來回 audit — panel & document 皆無水平溢出', async ({ page }, testInfo) => {
    const width = testInfo.project.use.viewport?.width ?? 1280;
    const widthMode = width >= 640 ? 'desktop' : 'mobile';
    const vpLabel = `vp${width}`;

    await drawerStep(`goto harness count=50 width=${widthMode} vp=${width}`, () =>
      gotoWithRetry(
        page,
        `/e2e/holdings-detail-panel-volume?count=50&width=${widthMode}`,
        { waitUntil: 'domcontentloaded' },
      ),
    );

    const panel = page.locator('[data-testid="holdings-detail-panel"]').first();
    await panel.waitFor({ state: 'visible', timeout: 15_000 });
    await page.evaluate(() => document.fonts?.ready);
    await page.waitForTimeout(200);

    // 前置檢查：抽屜內容真的長到需要捲動，否則本 spec 沒鑑別度
    const scroller = await measureScroller(panel);
    expect(
      scroller.maxScroll,
      `[${vpLabel}] 抽屜內容不足以捲動（scrollHeight=${scroller.scrollHeight} clientHeight=${scroller.clientHeight}），harness 需要 count=50`,
    ).toBeGreaterThan(50);

    for (const method of ['programmatic', 'wheel', 'keyboard'] as const) {
      await drawerStep(`method=${method}`, () => runScrollMethod(page, panel, method, testInfo, vpLabel));
    }
  });
});
