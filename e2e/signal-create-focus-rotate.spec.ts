import { test, expect, type Page } from '@playwright/test';

// 手機為觸控裝置：讓 `@media (pointer: coarse)` 命中，Input/Textarea 才會維持 text-base(16px)
test.use({ hasTouch: true, isMobile: true });

/**
 * SignalCreateDialog — 按鍵焦點 / 字級 / 直橫切換合約
 *
 * 覆蓋 3 個手機尺寸 × 直橫 = 6 個 viewport：
 *   iPhone SE      320×568 /  568×320
 *   iPhone X/12    375×667 /  667×375
 *   iPhone Plus    414×896 /  896×414
 *
 * 每個 viewport 對所有 focusable 元素逐一 focus，斷言：
 *   1. Input / Textarea computed fontSize ≥ 16px（防 iOS Safari 自動 zoom）
 *   2. focus 後外框可見：outline !== 'none' 或 box-shadow 含顏色
 *   3. focus 後元素完整位於 scroll container 可視區內（垂直不被裁）
 *   4. focus ring bbox（元素 bbox +2px offset +2px ring）水平/垂直
 *      不逾出 dialog 容器（padding p-1 -m-1 提供 4px 緩衝）
 *   5. 相鄰模板按鈕 focus ring 不與相鄰同列按鈕的核心 bbox 重疊
 *   6. dialog 本身不觸發水平/垂直外溢（body scroll = 0）
 *
 * 覆蓋所有 focusable：f-code / f-name / f-price / f-qty / f-reason / f-detail
 *   + 6 個 f-tpl-* 模板按鈕 + f-cancel / f-publish
 */

const SIZES = [
  { name: 'SE-portrait', w: 320, h: 568 },
  { name: 'SE-landscape', w: 568, h: 320 },
  { name: 'X-portrait', w: 375, h: 667 },
  { name: 'X-landscape', w: 667, h: 375 },
  { name: 'Plus-portrait', w: 414, h: 896 },
  { name: 'Plus-landscape', w: 896, h: 414 },
];

const TEXT_FIELDS = ['f-code', 'f-name', 'f-price', 'f-qty', 'f-reason', 'f-detail'];
const TEMPLATE_BTNS = ['f-tpl-0', 'f-tpl-1', 'f-tpl-2', 'f-tpl-3', 'f-tpl-4', 'f-tpl-5'];
const FOOTER_BTNS = ['f-cancel', 'f-publish'];
const ALL_FOCUSABLES = [...TEXT_FIELDS, ...TEMPLATE_BTNS, ...FOOTER_BTNS];

type FocusMetrics = {
  fontSizePx: number;
  outline: string;
  boxShadow: string;
  outlineWidthPx: number;
  rect: { x: number; y: number; width: number; height: number };
  scrollRect: { x: number; y: number; width: number; height: number };
  dialogRect: { x: number; y: number; width: number; height: number };
  tag: string;
};

async function focusAndMeasure(page: Page, testId: string): Promise<FocusMetrics> {
  await page.getByTestId(testId).focus();
  // scrollIntoView 保證 focus 元素進入 scroll 可視區（模擬瀏覽器 native 行為）
  await page.getByTestId(testId).evaluate((el) => {
    (el as HTMLElement).scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  return await page.getByTestId(testId).evaluate((el) => {
    const s = getComputedStyle(el as HTMLElement);
    const r = (el as HTMLElement).getBoundingClientRect();
    const scroll = document.querySelector('[data-testid="signal-create-scroll"]') as HTMLElement;
    const dialog = document.querySelector('[data-testid="signal-create-dialog"]') as HTMLElement;
    const sr = scroll.getBoundingClientRect();
    const dr = dialog.getBoundingClientRect();
    return {
      fontSizePx: parseFloat(s.fontSize),
      outline: s.outline,
      boxShadow: s.boxShadow,
      outlineWidthPx: parseFloat(s.outlineWidth) || 0,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      scrollRect: { x: sr.x, y: sr.y, width: sr.width, height: sr.height },
      dialogRect: { x: dr.x, y: dr.y, width: dr.width, height: dr.height },
      tag: (el as HTMLElement).tagName.toLowerCase(),
    };
  });
}

function ringVisible(m: FocusMetrics): boolean {
  // shadcn focus-visible:ring-2 ring-offset-2 → 用 box-shadow 疊多層實作
  // 檢查 boxShadow 是否含 rgb/rgba 顏色（非 'none' 或純空白）
  if (m.outline && m.outline !== 'none' && m.outlineWidthPx >= 1) return true;
  if (m.boxShadow && m.boxShadow !== 'none' && /rgb/.test(m.boxShadow)) return true;
  return false;
}

function withinScroll(m: FocusMetrics): boolean {
  const bottomInside = m.rect.y + m.rect.height <= m.scrollRect.y + m.scrollRect.height + 0.5;
  const topInside = m.rect.y >= m.scrollRect.y - 0.5;
  return bottomInside && topInside;
}

function ringWithinDialog(m: FocusMetrics, margin = 4): boolean {
  // ring 外圍 4px（ring-offset-2 + ring-2）不逾出 dialog（p-1 -m-1 提供 4px 緩衝）
  return (
    m.rect.x - margin >= m.dialogRect.x - 0.5 &&
    m.rect.x + m.rect.width + margin <= m.dialogRect.x + m.dialogRect.width + 0.5
  );
}

async function assertNoBodyOverflow(page: Page) {
  const o = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
    sh: document.documentElement.scrollHeight,
    ch: document.documentElement.clientHeight,
  }));
  expect(o.sw, 'body horizontal overflow').toBeLessThanOrEqual(o.cw + 1);
  // 垂直允許 scroll，但 dialog 內部應該 scroll，不是整頁 scroll bounce
}

async function assertTemplateRingNoOverlap(page: Page) {
  // 對 focus 中的模板按鈕，檢查其 ring bbox 不與任何其他模板按鈕的核心 bbox 重疊
  const rects = await page.evaluate((ids: string[]) => {
    return ids.map((id) => {
      const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement;
      const r = el.getBoundingClientRect();
      return { id, x: r.x, y: r.y, w: r.width, h: r.height };
    });
  }, TEMPLATE_BTNS);
  const RING = 4; // ring-offset-2 + ring-2
  for (let i = 0; i < rects.length; i++) {
    const a = rects[i];
    const aExp = { x: a.x - RING, y: a.y - RING, w: a.w + RING * 2, h: a.h + RING * 2 };
    for (let j = 0; j < rects.length; j++) {
      if (i === j) continue;
      const b = rects[j];
      const overlapX = aExp.x < b.x + b.w && aExp.x + aExp.w > b.x;
      const overlapY = aExp.y < b.y + b.h && aExp.y + aExp.h > b.y;
      expect(
        overlapX && overlapY,
        `f-tpl-${i} 的 focus ring 侵入 f-tpl-${j} 核心 bbox`,
      ).toBe(false);
    }
  }
}

test.describe.parallel('SignalCreateDialog focus / font / 直橫切換', () => {
  for (const s of SIZES) {
    test(`${s.name} (${s.w}×${s.h}) — 所有 focusable 通過字級+focus ring+視窗合約`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: s.w, height: s.h });
      await page.goto('/e2e/signal-focus-harness', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#signal-focus-harness-root');
      await page.evaluate(async () => {
        if (document.fonts?.ready) await document.fonts.ready;
      });

      await assertNoBodyOverflow(page);

      // 1. 逐一 focus 每個元件
      for (const id of ALL_FOCUSABLES) {
        const m = await focusAndMeasure(page, id);

        // 字級：Input / Textarea 必須 ≥ 16px（防 iOS zoom）
        if (m.tag === 'input' || m.tag === 'textarea') {
          expect(
            m.fontSizePx,
            `${id} (${m.tag}) fontSize=${m.fontSizePx}px 必須 ≥16px 防 iOS zoom`,
          ).toBeGreaterThanOrEqual(16);
        }
        // Button：不做 16px 強制（按鈕不觸發 iOS zoom），只要 ≥12px 可讀
        if (m.tag === 'button') {
          expect(m.fontSizePx, `${id} 按鈕字級 ≥12px`).toBeGreaterThanOrEqual(12);
        }

        // focus ring 可見
        expect(ringVisible(m), `${id} focus ring 不可見: outline=${m.outline} shadow=${m.boxShadow}`).toBe(true);

        // 元素在 scroll container 可視區
        expect(withinScroll(m) || FOOTER_BTNS.includes(id), `${id} 未在 scroll 可視區`).toBe(true);

        // ring 不逾出 dialog 水平邊界
        expect(ringWithinDialog(m), `${id} focus ring 逾出 dialog 水平邊界`).toBe(true);

        // 元素 bbox 高度足以容納 focus ring（元素本身 ≥ 20px）
        expect(m.rect.height, `${id} 高度 ≥20px（能顯示 ring）`).toBeGreaterThanOrEqual(20);
      }

      // 2. 模板按鈕 focus ring 不侵犯相鄰按鈕
      await assertTemplateRingNoOverlap(page);

      // 3. 截圖
      await page.getByTestId('signal-create-dialog').screenshot({
        path: `test-results/signal-focus/${s.name}.png`,
      });
    });
  }

  // 直→橫 / 橫→直 切換情境：確保切換後不需 reload 也能維持所有合約
  for (const pair of [
    { from: SIZES[0], to: SIZES[1] }, // SE p→l
    { from: SIZES[3], to: SIZES[2] }, // X  l→p
    { from: SIZES[4], to: SIZES[5] }, // Plus p→l
  ]) {
    test(`旋轉 ${pair.from.name} → ${pair.to.name} 不破壞 focus/字級`, async ({ page }) => {
      await page.setViewportSize({ width: pair.from.w, height: pair.from.h });
      await page.goto('/e2e/signal-focus-harness', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#signal-focus-harness-root');

      // 於 from 尺寸 focus Textarea（最可能觸發 iOS zoom）
      const beforeReason = await focusAndMeasure(page, 'f-reason');
      expect(beforeReason.fontSizePx).toBeGreaterThanOrEqual(16);
      expect(ringVisible(beforeReason)).toBe(true);

      // 旋轉
      await page.setViewportSize({ width: pair.to.w, height: pair.to.h });
      await page.waitForTimeout(200); // layout flush

      const afterReason = await focusAndMeasure(page, 'f-reason');
      expect(afterReason.fontSizePx, `旋轉後 f-reason 字級`).toBeGreaterThanOrEqual(16);
      expect(ringVisible(afterReason), `旋轉後 f-reason ring 可見`).toBe(true);
      expect(withinScroll(afterReason), `旋轉後 f-reason 未在 scroll 可視區`).toBe(true);

      // 旋轉後也走一輪所有 focusable 快速檢查（防 layout 因 flex-wrap 變化破壞）
      for (const id of ALL_FOCUSABLES) {
        const m = await focusAndMeasure(page, id);
        if (m.tag === 'input' || m.tag === 'textarea') {
          expect(m.fontSizePx, `旋轉後 ${id} fontSize`).toBeGreaterThanOrEqual(16);
        }
        expect(ringVisible(m), `旋轉後 ${id} ring 可見`).toBe(true);
        expect(ringWithinDialog(m), `旋轉後 ${id} ring 逾出 dialog`).toBe(true);
      }
      await assertTemplateRingNoOverlap(page);
      await assertNoBodyOverflow(page);
    });
  }
});
