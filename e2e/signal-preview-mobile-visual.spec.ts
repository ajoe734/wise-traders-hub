import { test, expect, type Page } from '@playwright/test';

/**
 * 手機寬度視覺回歸：SignalCreateDialog 的訂閱者預覽列 + PreviewTradeItem
 *
 * 覆蓋範圍：
 *   - 兩種容易擠壓的 ETF：00631L 元大台灣50正2 / 00878B 國泰永續高股息
 *   - 5 個手機/窄平板斷點：320 / 360 / 375 / 414 / 480 px
 *
 * 斷言：
 *   1. 頁面本身不觸發橫向 scroll
 *   2. 兩個 section 容器 scrollWidth <= clientWidth（不溢出）
 *   3. 代號 / 名稱 / 價位 / 數量四個 span bbox 皆非零
 *   4. 相鄰 span 在同一 baseline 上不水平重疊（不同列則跳過重疊檢查）
 *   5. 每個代號/名稱 textContent 完整保留（含 L/B 字尾）
 *   6. 每個斷點輸出截圖 artifact 供人工回歸
 */

const CASES = [
  { code: '00631L', name: '元大台灣50正2', price: '123.45', qty: '2', unit: '張' },
  { code: '00878B', name: '國泰永續高股息', price: '22.85', qty: '10', unit: '張' },
];

const WIDTHS = [320, 360, 375, 414, 480];

type Rect = { x: number; y: number; width: number; height: number };

function overlapsHorizontally(a: Rect, b: Rect) {
  // 同一列：垂直中心差 < 兩者高度較小值的一半 → 視為同 baseline
  const aMid = a.y + a.height / 2;
  const bMid = b.y + b.height / 2;
  const sameRow = Math.abs(aMid - bMid) < Math.min(a.height, b.height) / 2;
  if (!sameRow) return false;
  const aRight = a.x + a.width;
  const bRight = b.x + b.width;
  // 允許 0.5px 抗鋸齒容差
  return !(aRight <= b.x + 0.5 || bRight <= a.x + 0.5);
}

async function assertNoOverlap(page: Page, testIds: string[], label: string) {
  const rects: Rect[] = [];
  for (const id of testIds) {
    const el = page.getByTestId(id);
    if ((await el.count()) === 0) continue;
    const box = await el.boundingBox();
    expect(box, `${label}: ${id} bbox`).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
    rects.push({ ...box!, });
  }
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      expect(
        overlapsHorizontally(rects[i], rects[j]),
        `${label}: ${testIds[i]} 與 ${testIds[j]} 於同列水平重疊`,
      ).toBe(false);
    }
  }
}

async function assertNoOverflow(page: Page, sectionId: string, w: number) {
  const box = await page.getByTestId(sectionId).evaluate((el) => ({
    scroll: (el as HTMLElement).scrollWidth,
    client: (el as HTMLElement).clientWidth,
  }));
  expect(box.scroll, `${sectionId} 溢出 @ ${w}px`).toBeLessThanOrEqual(box.client);
}

test.describe.parallel('SignalCreateDialog + PreviewTradeItem — 手機寬度不重疊/不溢出', () => {
  for (const c of CASES) {
    for (const w of WIDTHS) {
      test(`${c.code} @ ${w}px`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: 900 });
        const url =
          `/e2e/signal-preview-harness?code=${c.code}` +
          `&name=${encodeURIComponent(c.name)}` +
          `&price=${c.price}&qty=${c.qty}&unit=${encodeURIComponent(c.unit)}`;
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#signal-preview-harness-root');
        // 等字體，避免測到 fallback 字寬
        await page.evaluate(async () => {
          if (document.fonts?.ready) await document.fonts.ready;
        });

        // 1. 頁面無橫向 scroll
        const bodyOverflow = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
        }));
        expect(bodyOverflow.scroll, `body overflow @ ${w}px`).toBeLessThanOrEqual(
          bodyOverflow.client,
        );

        // 2. 兩個 section 不溢出
        await assertNoOverflow(page, 'section-preview-trade-item', w);
        await assertNoOverflow(page, 'section-advisor-preview', w);

        // 3+4. Advisor preview row：Badge / instrument / price / qty 四塊不重疊
        await assertNoOverlap(
          page,
          ['adv-code', 'adv-name', 'adv-price', 'adv-qty'],
          `advisor @ ${w}`,
        );

        // 5. 文字完整保留（含字尾）
        const codeText = (await page.getByTestId('adv-code').textContent())?.trim() ?? '';
        const nameText = (await page.getByTestId('adv-name').textContent())?.trim() ?? '';
        expect(codeText).toBe(c.code);
        expect(nameText).toBe(c.name);

        // 6. 截圖存查
        await page
          .getByTestId('section-preview-trade-item')
          .screenshot({ path: `test-results/signal-preview/${c.code}-${w}-trade-item.png` });
        await page
          .getByTestId('section-advisor-preview')
          .screenshot({ path: `test-results/signal-preview/${c.code}-${w}-advisor.png` });
      });
    }
  }
});
