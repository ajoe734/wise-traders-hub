import { test, expect, type Page } from '@playwright/test';

/**
 * 代號 / 名稱 字型 + 字距 + 可讀性合約
 *
 * 覆蓋所有渲染 ETF 代號+名稱的 4 個表面：
 *   A. PreviewTradeItem                    (harness: pti-code / pti-name)
 *   B. SignalCreateDialog 訂閱者預覽列     (harness: adv-code / adv-name)
 *   C. JournalDetail 列表列                (harness: jd-code / jd-name)
 *   D. SignalDetail 標題                   (harness: sd-code / sd-name)
 *
 * 針對 2 檔 ETF × 3 手機斷點（320/375/414）逐一驗證：
 *
 *   1. code 必須為等寬字型（font-family 含 mono 家族之一）
 *      + font-variant-numeric 含 'tabular-nums'（數字對齊）
 *   2. name 必須為 sans/系統字型（不含 mono），與 code 視覺區分
 *   3. letter-spacing 套用正確：
 *      - tracking-normal (=0em)   → PreviewTradeItem / Advisor code
 *      - tracking-tight (≈-0.4px) → JournalDetail / SignalDetail code
 *                                 + PreviewTradeItem / Advisor name
 *   4. 可讀性：fontSize ≥ 12px、line-height 至少能容納字身
 *      （computed height >= fontSize * 1.0）
 *   5. 顏色不能是透明或與背景同色（alpha > 0）
 */

type Surface = 'pti' | 'adv' | 'jd' | 'sd';

const CASES = [
  { code: '00631L', name: '元大台灣50正2' },
  { code: '00878B', name: '國泰永續高股息' },
];
const WIDTHS = [320, 375, 414];

// 生產端 tracking 設定 — 與 tailwind 對應：
//   tracking-normal = 0em、tracking-tight = -0.025em
// 於 13–14px 字級下換算：0em → 0px；-0.025em → 約 -0.325 ~ -0.35px
const CODE_TRACKING_NORMAL: Surface[] = ['pti', 'adv'];
const CODE_TRACKING_TIGHT: Surface[] = ['jd', 'sd'];

async function computed(page: Page, testId: string) {
  return await page.getByTestId(testId).evaluate((el) => {
    const s = getComputedStyle(el as HTMLElement);
    const rect = (el as HTMLElement).getBoundingClientRect();
    return {
      fontFamily: s.fontFamily,
      fontVariantNumeric: s.fontVariantNumeric,
      letterSpacingPx: parseFloat(s.letterSpacing) || 0, // 'normal' → NaN → 0
      letterSpacingRaw: s.letterSpacing,
      fontSizePx: parseFloat(s.fontSize),
      lineHeightPx: parseFloat(s.lineHeight) || parseFloat(s.fontSize),
      color: s.color,
      height: rect.height,
      width: rect.width,
    };
  });
}

function isMono(family: string) {
  const f = family.toLowerCase();
  return /mono|menlo|monaco|consolas|courier|"sfmono"|ui-monospace/.test(f);
}
function parseAlpha(color: string): number {
  const m = color.match(/rgba?\(([^)]+)\)/i);
  if (!m) return 1;
  const parts = m[1].split(',').map((s) => s.trim());
  return parts.length >= 4 ? parseFloat(parts[3]) : 1;
}

async function gotoHarness(page: Page, harness: 'signal-preview' | 'etf-display', c: { code: string; name: string }) {
  const url =
    harness === 'signal-preview'
      ? `/e2e/signal-preview-harness?code=${c.code}&name=${encodeURIComponent(c.name)}&price=123.45&qty=1&unit=%E5%BC%B5`
      : `/e2e/etf-display-harness?code=${c.code}&name=${encodeURIComponent(c.name)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });
}

async function assertCodeStyle(page: Page, surface: Surface, w: number) {
  const s = await computed(page, `${surface}-code`);
  expect(isMono(s.fontFamily), `${surface}-code @${w} font-family(mono): ${s.fontFamily}`).toBe(true);
  expect(s.fontVariantNumeric, `${surface}-code @${w} fontVariantNumeric`).toContain('tabular-nums');
  if (CODE_TRACKING_NORMAL.includes(surface)) {
    expect(Math.abs(s.letterSpacingPx), `${surface}-code @${w} tracking-normal`).toBeLessThan(0.1);
  } else if (CODE_TRACKING_TIGHT.includes(surface)) {
    // -0.025em @ 13–24px → -0.325 ~ -0.6px；容忍取 [-0.9, -0.15]
    expect(s.letterSpacingPx, `${surface}-code @${w} tracking-tight (raw=${s.letterSpacingRaw})`).toBeLessThan(-0.15);
    expect(s.letterSpacingPx, `${surface}-code @${w} tracking-tight (raw=${s.letterSpacingRaw})`).toBeGreaterThan(-0.9);
  }
  expect(s.fontSizePx, `${surface}-code @${w} readable size ≥12px`).toBeGreaterThanOrEqual(12);
  expect(s.lineHeightPx, `${surface}-code @${w} line-height 容納字身`).toBeGreaterThanOrEqual(s.fontSizePx);
  expect(parseAlpha(s.color), `${surface}-code @${w} 顏色 alpha>0`).toBeGreaterThan(0);
  expect(s.width).toBeGreaterThan(0);
  expect(s.height).toBeGreaterThan(0);
}

async function assertNameStyle(page: Page, surface: Surface, w: number) {
  const s = await computed(page, `${surface}-name`);
  expect(isMono(s.fontFamily), `${surface}-name @${w} 不應為 mono: ${s.fontFamily}`).toBe(false);
  // pti/adv 名稱明確 tracking-tight；jd/sd 名稱繼承 parent（未指定），至少不能被強制拉寬
  if (surface === 'pti' || surface === 'adv') {
    expect(s.letterSpacingPx, `${surface}-name @${w} tracking-tight`).toBeLessThan(-0.15);
  } else {
    expect(s.letterSpacingPx, `${surface}-name @${w} 不應正向 tracking`).toBeLessThanOrEqual(0.1);
  }
  expect(s.fontSizePx, `${surface}-name @${w} 可讀 ≥12px`).toBeGreaterThanOrEqual(12);
  expect(s.lineHeightPx, `${surface}-name @${w} line-height`).toBeGreaterThanOrEqual(s.fontSizePx);
  expect(parseAlpha(s.color), `${surface}-name @${w} alpha>0`).toBeGreaterThan(0);
  expect(s.width).toBeGreaterThan(0);
  expect(s.height).toBeGreaterThan(0);
}

test.describe.parallel('ETF 代號/名稱 字型+字距+可讀性 — 手機三斷點', () => {
  for (const c of CASES) {
    for (const w of WIDTHS) {
      test(`${c.code} @ ${w}px — PreviewTradeItem + Advisor preview`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: 900 });
        await gotoHarness(page, 'signal-preview', c);
        await page.waitForSelector('#signal-preview-harness-root');
        await assertCodeStyle(page, 'pti', w);
        await assertNameStyle(page, 'pti', w);
        await assertCodeStyle(page, 'adv', w);
        await assertNameStyle(page, 'adv', w);
      });

      test(`${c.code} @ ${w}px — JournalDetail + SignalDetail`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: 900 });
        await gotoHarness(page, 'etf-display', c);
        await page.waitForSelector('#etf-display-harness-root');
        await assertCodeStyle(page, 'jd', w);
        await assertNameStyle(page, 'jd', w);
        await assertCodeStyle(page, 'sd', w);
        await assertNameStyle(page, 'sd', w);
      });
    }
  }
});
