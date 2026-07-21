/**
 * E2E · HoldingsDetailPanel 抽屜「載入中 → 渲染完成」全流程幾何守門
 *
 * 目的：確保「骨架階段」與「真實內容渲染後」兩個生命週期都不會出現水平溢出、
 * 也不會在切換的瞬間（layout thrash）觸發溢出守門。
 *
 * 覆蓋（不准偷懶）：
 *   1. skeleton 階段 audit：進頁面立即擷取，此時 data-drawer-render-state="skeleton"
 *      - document.scrollWidth ≤ clientWidth + 1
 *      - panel.boundingBox 未外溢視窗
 *      - 純幾何 element / text-node overflow 為空、fontSize ≤ 22
 *      - CI-strict hard cap
 *   2. transition 瞬間 audit：切換發生後 ~50ms 內立刻再抓一次
 *      （最容易漏檢的層 — 骨架剛移除但真實 layout 尚未 settle）
 *   3. ready 階段 audit：等 data-drawer-render-state="ready" + fonts.ready 後再驗
 *   4. VolatilityTracker：三個階段 maxOverflow 極差不得跳動
 *   5. 四個 viewport（320 / 390 / 768 / 1280）× 兩個 loading 延遲（400ms / 1200ms）
 *      — 短延遲測「骨架幾乎沒出現」的臨界，長延遲測「骨架穩定顯示」的完整週期
 *
 * harness：/e2e/holdings-detail-panel-volume?count=50&loading=NNN
 *   > 0：先渲染骨架 NNN ms 再切到真實內容，並在容器上打上 data-drawer-render-state
 *
 * 失敗產物：test-results/holdings-drawer/loading-to-ready-<w>/ 內含
 *   trace / video / overflow-annotated-<label>.png / overflow-findings-<label>.json
 *   label 帶 phase（skeleton / transition / ready）與 loading 延遲，可直接對照
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
const LOADING_DELAYS_MS = [400, 1200] as const;

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
      if (text && overflow > tolerance) badBoxes.push({
        tag: el.tagName.toLowerCase(), text,
        left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        rootLeft: rootBox.left, rootRight: rootBox.right,
        overflow,
      });
    }

    // 見 holdings-detail-panel-stress-content.spec.ts 相同修法：
    // Range.getClientRects() 回傳文字內在版面寬度，不會被 overflow:hidden 收斂，
    // 因此需自行沿祖先鏈找到裁切邊界後再判定「視覺可見溢出」。
    const findClipBox = (parent: Element | null) => {
      let cur: Element | null = parent;
      let clipLeft = -Infinity;
      let clipRight = Infinity;
      while (cur && cur !== root) {
        const cs = window.getComputedStyle(cur);
        const overflowX = cs.overflowX || cs.overflow;
        if (overflowX && overflowX !== 'visible') {
          const box = cur.getBoundingClientRect();
          if (box.left > clipLeft) clipLeft = box.left;
          if (box.right < clipRight) clipRight = box.right;
        }
        cur = cur.parentElement;
      }
      return { clipLeft, clipRight };
    };

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
      const { clipLeft, clipRight } = findClipBox(node.parentElement);
      for (const rect of rects) {
        const visibleLeft = Math.max(rect.left, clipLeft);
        const visibleRight = Math.min(rect.right, clipRight);
        if (visibleRight <= rootBox.right + tolerance && visibleLeft >= rootBox.left - tolerance) continue;
        const overflow = Math.max(rootBox.left - visibleLeft, visibleRight - rootBox.right, 0);
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
 * 執行單一 phase 的四層守門 + 記錄到 VolatilityTracker
 */
async function guardPhase(
  page: Page,
  panel: Locator,
  testInfo: import('@playwright/test').TestInfo,
  tracker: VolatilityTracker,
  label: string,
  ctx: string,
) {
  // 1) 文件無水平 scrollbar
  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(
    viewport.scrollWidth,
    `${ctx} document scrollWidth(${viewport.scrollWidth}) > clientWidth(${viewport.clientWidth})`,
  ).toBeLessThanOrEqual(viewport.clientWidth + 1);

  // 2) panel bounding box 未外溢視窗
  const panelBox = await panel.boundingBox();
  expect(panelBox, `${ctx} panel bounding box should exist`).not.toBeNull();
  if (panelBox) {
    expect(panelBox.x, `${ctx} panel left overflow`).toBeGreaterThanOrEqual(-0.5);
    expect(
      panelBox.x + panelBox.width,
      `${ctx} panel right overflow`,
    ).toBeLessThanOrEqual(viewport.clientWidth + 0.5);
  }

  // 3) 幾何 audit
  const audit = await auditPanel(panel);
  const findings = mergeAuditFindings(audit);
  if (findings.length > 0) {
    await annotateOverflowAndAttach(page, panel, findings, testInfo, label);
  }
  tracker.record(label, findingsMaxOverflow(findings));

  expect(audit.badFonts, `${ctx} font-size > ${MAX_FONT_PX}px`).toEqual([]);
  expect(
    audit.badBoxes,
    `${ctx} element overflow (tol=${OVERFLOW_TOLERANCE_PX}px)`,
  ).toEqual([]);
  expect(
    audit.badTextNodes,
    `${ctx} text node overflow (tol=${OVERFLOW_TOLERANCE_PX}px)`,
  ).toEqual([]);

  // 4) CI-strict：單一 overflow 硬上限
  assertOverflowHardCap(findings, label);
}

test.describe('HoldingsDetailPanel · 載入中 → 渲染完成 生命週期幾何守門', () => {
  for (const loadingMs of LOADING_DELAYS_MS) {
    test(`loading=${loadingMs}ms · skeleton / transition / ready 三階段皆無溢出`, async ({ page }, testInfo) => {
      const width = testInfo.project.use.viewport?.width ?? 1280;
      const widthMode = width >= 640 ? 'desktop' : 'mobile';
      const vpLabel = `vp${width}-loading${loadingMs}`;
      const tracker = new VolatilityTracker(`loading-to-ready ${vpLabel}`);

      await drawerStep(`goto harness count=50 width=${widthMode} loading=${loadingMs}`, () =>
        gotoWithRetry(
          page,
          `/e2e/holdings-detail-panel-volume?count=50&width=${widthMode}&loading=${loadingMs}`,
          { waitUntil: 'domcontentloaded' },
        ),
      );

      const panel = page.locator('[data-testid="holdings-detail-panel"]').first();
      await panel.waitFor({ state: 'visible', timeout: 15_000 });

      // === Phase 1: skeleton — 立即抓（在 loadingMs 到期前）===
      // 若 loadingMs 太短、還沒 audit 就切走，這 phase 直接跳過（並不記入 tracker）。
      const initialState = await panel.getAttribute('data-drawer-render-state');
      expect(
        initialState,
        `[${vpLabel}] 初始 render state 應為 skeleton（loadingMs=${loadingMs}）`,
      ).toBe('skeleton');

      // 骨架節點必須存在
      const skeleton = page.locator('[data-testid="holdings-detail-panel-skeleton"]');
      await expect(
        skeleton,
        `[${vpLabel}] 骨架節點應可見`,
      ).toBeVisible({ timeout: 2_000 });

      // 骨架 aria — 給 SR 使用者的載入提示
      await expect(
        skeleton,
        `[${vpLabel}] 骨架 role/aria-live 契約`,
      ).toHaveAttribute('role', 'status');

      await drawerStep(`guard phase=skeleton`, () =>
        guardPhase(page, panel, testInfo, tracker,
          `${vpLabel}-skeleton`, `[${vpLabel} phase=skeleton]`),
      );

      // === Phase 2: transition — 切換發生後立刻抓（layout thrash 高風險視窗）===
      await drawerStep(`wait render state → ready`, async () => {
        await page.waitForFunction(
          () => document.querySelector('[data-testid="holdings-detail-panel"]')
            ?.getAttribute('data-drawer-render-state') === 'ready',
          undefined,
          { timeout: 5_000 },
        );
      });
      // 剛切換的第一幀：不等 fonts.ready、不等 timeout，用最短 rAF 讓 React commit
      await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
      await drawerStep(`guard phase=transition`, () =>
        guardPhase(page, panel, testInfo, tracker,
          `${vpLabel}-transition`, `[${vpLabel} phase=transition (post-swap rAF)]`),
      );

      // === Phase 3: ready — 等 fonts + 250ms settle 後再驗 ===
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(250);

      // 確認真實內容已載入（decisionsMap 相關文字或列表項）
      const readyMeta = await panel.evaluate((el) => ({
        state: el.getAttribute('data-drawer-render-state'),
        listCount: el.getAttribute('data-volume-list-count'),
        hasSkeleton: !!document.querySelector('[data-testid="holdings-detail-panel-skeleton"]'),
      }));
      expect(readyMeta.state, `[${vpLabel}] ready phase state`).toBe('ready');
      expect(readyMeta.hasSkeleton, `[${vpLabel}] 骨架不得殘留`).toBe(false);

      await drawerStep(`guard phase=ready`, () =>
        guardPhase(page, panel, testInfo, tracker,
          `${vpLabel}-ready`, `[${vpLabel} phase=ready listCount=${readyMeta.listCount}]`),
      );

      // === 波動守門：三 phase maxOverflow 極差不得跳動 ===
      tracker.assertRange();
    });
  }
});
