/**
 * E2E 回歸 — HoldingsDetailPanel 抽屜整體 RWD / legacy 清除守門
 *
 * 覆蓋：320 / 375 / 390 / 414 / 560 / 768 / 863 / 1024 / 1280
 * 目的：避免 legacy FreeCheckup drawer（返回列表 / 來自：/ DECISION / TARGETS / tab bar）再混回來，
 *      並確保新版抽屜所有主要文字與 panel 本體不水平溢出，字級不超過 22px。
 */
import { test, expect, type Page } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';

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

    await primeDemo(page);
    await gotoWithRetry(page, '/holding-checkup-demo', { waitUntil: 'domcontentloaded' });

    const firstCard = page.locator('.wb-card').first();
    await firstCard.waitFor({ state: 'visible', timeout: 15_000 });
    await firstCard.scrollIntoViewIfNeeded();
    await firstCard.click();

    const panel = page.locator('[data-testid="holdings-detail-panel"]').first();
    await panel.waitFor({ state: 'visible', timeout: 15_000 });
    await page.evaluate(() => document.fonts?.ready);
    await page.waitForTimeout(250);

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

    const audit = await panel.evaluate((root, maxFontPx) => {
      const rootBox = root.getBoundingClientRect();
      const badFonts: Array<{ tag: string; text: string; fontSize: number }> = [];
      const badBoxes: Array<{ tag: string; text: string; left: number; right: number; rootLeft: number; rootRight: number }> = [];
      const badTextNodes: Array<{ text: string; left: number; right: number; rootLeft: number; rootRight: number }> = [];

      const visible = (el: Element) => {
        const cs = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        let cur: Element | null = el;
        const visuallyHidden =
          !!el.closest('[data-radix-visually-hidden], .sr-only') ||
          (() => {
            while (cur && cur !== root) {
              const curCs = window.getComputedStyle(cur);
              const curRect = cur.getBoundingClientRect();
              const cls = String((cur as HTMLElement).className || '');
              if (
                cls.includes('sr-only') ||
                cur.hasAttribute('data-radix-visually-hidden') ||
                curCs.clip !== 'auto' ||
                curCs.clipPath !== 'none' ||
                (curCs.position === 'absolute' && curRect.width <= 1 && curRect.height <= 1)
              ) return true;
              cur = cur.parentElement;
            }
            return false;
          })();
        return !visuallyHidden && cs.display !== 'none' && cs.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };

      const elements = Array.from(root.querySelectorAll('*')).filter(visible);
      for (const el of elements) {
        const cs = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        const fontSize = Number.parseFloat(cs.fontSize || '0');
        if (Number.isFinite(fontSize) && fontSize > maxFontPx + 0.01) {
          badFonts.push({ tag: el.tagName.toLowerCase(), text, fontSize });
        }
        if (text && (rect.left < rootBox.left - 1 || rect.right > rootBox.right + 1)) {
          badBoxes.push({
            tag: el.tagName.toLowerCase(), text,
            left: rect.left, right: rect.right,
            rootLeft: rootBox.left, rootRight: rootBox.right,
          });
        }
      }

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const value = (node.textContent || '').replace(/\s+/g, '').trim();
          if (!value) return NodeFilter.FILTER_REJECT;
          const parent = node.parentElement;
          if (!parent || !visible(parent)) return NodeFilter.FILTER_REJECT;
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
          if (rect.left < rootBox.left - 1 || rect.right > rootBox.right + 1) {
            badTextNodes.push({
              text: (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
              left: rect.left, right: rect.right,
              rootLeft: rootBox.left, rootRight: rootBox.right,
            });
          }
        }
      }

      return { badFonts, badBoxes, badTextNodes };
    }, MAX_FONT_PX);

    expect(audit.badFonts, `[${width}px] font-size > ${MAX_FONT_PX}px`).toEqual([]);
    expect(audit.badBoxes, `[${width}px] visible element overflows panel`).toEqual([]);
    expect(audit.badTextNodes, `[${width}px] visible text node overflows panel`).toEqual([]);
  });
});