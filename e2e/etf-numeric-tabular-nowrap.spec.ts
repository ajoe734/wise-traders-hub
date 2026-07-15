import { test, expect, type Page } from '@playwright/test';

/**
 * @價 + 張/股 tabular-nums 不擠壓/不截斷合約
 *
 * 覆蓋 4 個渲染表面（生產 + harness 一一對應）：
 *   A. PreviewTradeItem                    /e2e/signal-preview-harness → pti-price
 *   B. SignalCreateDialog 訂閱者預覽       /e2e/signal-preview-harness → adv-price / adv-qty
 *   C. JournalDetail 列表列                /e2e/etf-display-harness    → jd-price  / jd-qty
 *   D. SignalDetail 參考價位               /e2e/etf-display-harness    → sd-price  / sd-qty
 *
 * 2 檔 ETF × 3 手機斷點（320/375/414）× 2 價位（一般 + 長價 1,234,567.89）
 *
 * 對每個目標 span 驗證：
 *   1. font-family 含 mono 家族（等寬）
 *   2. font-variant-numeric 含 'tabular-nums'（數字對齊）
 *   3. white-space === 'nowrap'（span 內不斷行）
 *   4. computed height ≤ fontSize × 1.9（單行，未因擠壓換行）
 *   5. textContent 完整保留幣別符號 + 全部數字 + 單位（張/股）
 *   6. 相鄰 span 在同一列時不水平重疊
 *   7. 整個 section scrollWidth ≤ clientWidth（不觸發水平溢出）
 *   8. 附截圖 artifact 供人工比對
 */

type SectionId = 'section-preview-trade-item' | 'section-advisor-preview' | 'section-journal-detail' | 'section-signal-detail';

const CASES = [
  { code: '00631L', name: '元大台灣50正2' },
  { code: '00878B', name: '國泰永續高股息' },
];
const WIDTHS = [320, 375, 414];
const PRICES = [
  { price: '123.45', qty: '2', label: 'short' },
  { price: '1,234,567.89', qty: '9999', label: 'long' },
];

type Metrics = {
  fontFamily: string;
  fontVariantNumeric: string;
  whiteSpace: string;
  fontSizePx: number;
  height: number;
  width: number;
  x: number;
  y: number;
  text: string;
};

async function metricsOf(page: Page, testId: string): Promise<Metrics | null> {
  const el = page.getByTestId(testId);
  if ((await el.count()) === 0) return null;
  return await el.evaluate((node) => {
    const s = getComputedStyle(node as HTMLElement);
    const r = (node as HTMLElement).getBoundingClientRect();
    return {
      fontFamily: s.fontFamily,
      fontVariantNumeric: s.fontVariantNumeric,
      whiteSpace: s.whiteSpace,
      fontSizePx: parseFloat(s.fontSize),
      height: r.height,
      width: r.width,
      x: r.x,
      y: r.y,
      text: (node.textContent || '').trim(),
    };
  });
}

function isMono(family: string) {
  return /mono|menlo|monaco|consolas|courier|"sfmono"|ui-monospace/i.test(family);
}

function overlapsHorizontally(a: Metrics, b: Metrics) {
  const aMid = a.y + a.height / 2;
  const bMid = b.y + b.height / 2;
  const sameRow = Math.abs(aMid - bMid) < Math.min(a.height, b.height) / 2;
  if (!sameRow) return false;
  return !(a.x + a.width <= b.x + 0.5 || b.x + b.width <= a.x + 0.5);
}

async function assertNumericSpan(m: Metrics | null, label: string, mustContain: string[]) {
  expect(m, `${label} exists`).not.toBeNull();
  const s = m!;
  expect(isMono(s.fontFamily), `${label} font-family(mono): ${s.fontFamily}`).toBe(true);
  expect(s.fontVariantNumeric, `${label} tabular-nums`).toContain('tabular-nums');
  expect(s.whiteSpace, `${label} white-space=nowrap`).toBe('nowrap');
  expect(s.height, `${label} 單行高（≤ fs*1.9=${s.fontSizePx * 1.9}）`).toBeLessThanOrEqual(s.fontSizePx * 1.9);
  expect(s.width, `${label} bbox width>0`).toBeGreaterThan(0);
  expect(s.height, `${label} bbox height>0`).toBeGreaterThan(0);
  for (const needle of mustContain) {
    expect(s.text, `${label} 文字含 "${needle}"`).toContain(needle);
  }
}

async function assertSectionNoOverflow(page: Page, sec: SectionId, w: number) {
  const box = await page.getByTestId(sec).evaluate((el) => ({
    scroll: (el as HTMLElement).scrollWidth,
    client: (el as HTMLElement).clientWidth,
  }));
  expect(box.scroll, `${sec} 溢出 @ ${w}px`).toBeLessThanOrEqual(box.client);
}

async function assertNoRowOverlap(page: Page, ids: string[], label: string) {
  const ms: Metrics[] = [];
  const names: string[] = [];
  for (const id of ids) {
    const m = await metricsOf(page, id);
    if (!m) continue;
    ms.push(m);
    names.push(id);
  }
  for (let i = 0; i < ms.length; i++) {
    for (let j = i + 1; j < ms.length; j++) {
      expect(
        overlapsHorizontally(ms[i], ms[j]),
        `${label}: ${names[i]} 與 ${names[j]} 同列水平重疊`,
      ).toBe(false);
    }
  }
}

test.describe.parallel('@價 + 張/股 tabular-nums 不擠壓/不截斷', () => {
  for (const c of CASES) {
    for (const w of WIDTHS) {
      for (const p of PRICES) {
        test(`${c.code} ${p.label}價 @${w}px — PreviewTradeItem + Advisor`, async ({ page }) => {
          await page.setViewportSize({ width: w, height: 900 });
          const url =
            `/e2e/signal-preview-harness?code=${c.code}` +
            `&name=${encodeURIComponent(c.name)}` +
            `&price=${encodeURIComponent(p.price)}&qty=${p.qty}&unit=%E5%BC%B5&cur=NT$`;
          await page.goto(url, { waitUntil: 'domcontentloaded' });
          await page.waitForSelector('#signal-preview-harness-root');
          await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; });

          // A. PreviewTradeItem @price（PreviewTradeItem 內部無 currency prefix，需含 '@' + price）
          const pti = await metricsOf(page, 'pti-price');
          await assertNumericSpan(pti, `pti-price @${w}`, ['@', p.price]);

          // B. Advisor preview @price + qty
          const advPrice = await metricsOf(page, 'adv-price');
          await assertNumericSpan(advPrice, `adv-price @${w}`, ['@', 'NT$', p.price]);
          const advQty = await metricsOf(page, 'adv-qty');
          await assertNumericSpan(advQty, `adv-qty @${w}`, [p.qty, '張']);

          // section 不溢出
          await assertSectionNoOverflow(page, 'section-preview-trade-item', w);
          await assertSectionNoOverflow(page, 'section-advisor-preview', w);

          // 不與相鄰 span 水平重疊
          await assertNoRowOverlap(page, ['adv-code', 'adv-name', 'adv-price', 'adv-qty'], `advisor@${w}`);

          await page
            .getByTestId('section-preview-trade-item')
            .screenshot({ path: `test-results/etf-numeric/${c.code}-${w}-${p.label}-pti.png` });
          await page
            .getByTestId('section-advisor-preview')
            .screenshot({ path: `test-results/etf-numeric/${c.code}-${w}-${p.label}-adv.png` });
        });

        test(`${c.code} ${p.label}價 @${w}px — JournalDetail + SignalDetail`, async ({ page }) => {
          await page.setViewportSize({ width: w, height: 900 });
          const url =
            `/e2e/etf-display-harness?code=${c.code}` +
            `&name=${encodeURIComponent(c.name)}` +
            `&price=${encodeURIComponent(p.price)}&qty=${p.qty}&unit=%E5%BC%B5&sym=NT$`;
          await page.goto(url, { waitUntil: 'domcontentloaded' });
          await page.waitForSelector('#etf-display-harness-root');
          await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; });

          // C. JournalDetail 價/量
          const jdPrice = await metricsOf(page, 'jd-price');
          await assertNumericSpan(jdPrice, `jd-price @${w}`, ['價', 'NT$', p.price]);
          const jdQty = await metricsOf(page, 'jd-qty');
          await assertNumericSpan(jdQty, `jd-qty @${w}`, [p.qty, '張']);

          // D. SignalDetail 參考價位 / 數量
          const sdPrice = await metricsOf(page, 'sd-price');
          await assertNumericSpan(sdPrice, `sd-price @${w}`, ['NT$', p.price]);
          const sdQty = await metricsOf(page, 'sd-qty');
          await assertNumericSpan(sdQty, `sd-qty @${w}`, [p.qty, '張']);

          await assertSectionNoOverflow(page, 'section-journal-detail', w);
          await assertSectionNoOverflow(page, 'section-signal-detail', w);

          await page
            .getByTestId('section-journal-detail')
            .screenshot({ path: `test-results/etf-numeric/${c.code}-${w}-${p.label}-jd.png` });
          await page
            .getByTestId('section-signal-detail')
            .screenshot({ path: `test-results/etf-numeric/${c.code}-${w}-${p.label}-sd.png` });
        });
      }
    }
  }
});
