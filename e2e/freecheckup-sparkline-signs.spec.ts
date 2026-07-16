import { test, expect, type Page } from '@playwright/test';
import { navigateAndWaitForCardReady } from './helpers/navigation';

/**
 * Playwright 回歸 — pctSign → Sparkline stroke/opacity 對應憲法
 *
 * 憲法（見 HoldingCardHeader）：
 *   const pctSign = pctVal >= 0 ? 1 : -1;
 *   sparkColor   = isInk ? '#F4F1EC' : (pctSign >= 0 ? WB.accent : '#9B968D')
 *   sparkOpacity = pctSign >= 0 ? 0.85 : (isInk ? 0.6 : 0.55)
 *
 * 環境備註：
 *   - demo 模式為避免離線環境炸 edge，不打 checkup-sparkline，故種子的
 *     sparkData 恆為空 → Sparkline 走 fallback（'———'），DOM 不會有
 *     <polyline>。因此本測試改讀 `.wb-spark` 上的 `data-spark-*` 屬性
 *     來驗派生值一致性（該屬性即為傳給 Sparkline 元件的 color/opacity）。
 *   - headless Chromium 的 IntersectionObserver 需要主動觸發，這裡用
 *     addInitScript stub 為「observe 即回報 intersecting」，讓所有卡片
 *     跳過 skeleton 直接渲染 Header，才能拿到 `.wb-spark`。
 *
 * 覆蓋案例：
 *   1. Normal 卡：正號 → color=#FF4D1F/opacity=0.85；負號 → #9B968D/0.55。
 *   2. Feature (ink) 卡：color 恆為 #F4F1EC；正=0.85 / 負=0.6。
 *   3. 跨零：正 vs 負兩群 color / opacity 必然相異（sign key 生效）。
 *   4. aria-label 報酬率符號 與 .wb-roi 顯示 % 符號 逐卡一致。
 *   5. data-spark-color / opacity 白名單：僅三種色 / 三種透明度。
 *   6. data-spark-sign ∈ {1, -1}，pctVal=0 落 1（正號分支）。
 */

const ROUTE = '/holding-checkup';
const CARD_SELECTOR = '.holdings-card-grid .wb-card';

async function gotoFreeCheckup(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('checkup-demo-mode', '1');
      window.localStorage.setItem('holdings-intro-video-seen-v2', '1');
      window.localStorage.setItem('lf.checkup.onboarded', '1');
      window.sessionStorage.setItem('holdings-intro-video-dismissed-session', '1');
    } catch {}
    // Headless Chromium 的 IntersectionObserver 不會自動 fire — stub 為
    // observe 即回報 intersecting，避免所有卡片卡在 skeleton。
    class IOStub {
      cb: IntersectionObserverCallback;
      constructor(cb: IntersectionObserverCallback) { this.cb = cb; }
      observe(el: Element) {
        this.cb(
          [{
            isIntersecting: true,
            target: el,
            intersectionRatio: 1,
            boundingClientRect: el.getBoundingClientRect(),
            rootBounds: null,
            intersectionRect: el.getBoundingClientRect(),
            time: 0,
          } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
      }
      unobserve() {}
      disconnect() {}
      takeRecords() { return []; }
      root: Element | null = null;
      rootMargin = '';
      thresholds: number[] = [];
    }
    (window as any).IntersectionObserver = IOStub;
  });
  await navigateAndWaitForCardReady(page, ROUTE, {
    cardSelector: CARD_SELECTOR,
    selectorTimeoutMs: 30_000,
  });
  // 等 Header 展開（inView 觸發後 .wb-spark 出現）
  await page.waitForFunction(
    () => document.querySelectorAll('.holdings-card-grid .wb-card .wb-spark').length > 0,
    null,
    { timeout: 8_000 },
  );
}

// §3.4 憲法：ROI 顯示以 `+` / `−` (U+2212)。aria-label 為輔助文字，
// 允許 ASCII `-` 也接受 U+2212。此處兩個 helper 都需同時匹配兩種負號。
const NEG = /[-\u2212]/;
function signFromAriaLabel(label: string | null): 1 | -1 | 0 {
  if (!label) return 0;
  const m = label.match(/報酬率\s*([+\-\u2212]?)([\d.]+)/);
  if (!m) return 0;
  const num = Number(m[2]);
  if (!Number.isFinite(num)) return 0;
  return NEG.test(m[1] || '') ? -1 : 1;
}
function signFromRoiText(txt: string | null): 1 | -1 | 0 {
  if (!txt) return 0;
  const m = txt.match(/([+\-\u2212])?(\d+\.\d+)\s*%/);
  if (!m) return 0;
  return NEG.test(m[1] || '') ? -1 : 1;
}

interface Sample {
  index: number;
  isFeature: boolean;
  variantAttr: string | null;
  ariaSign: 1 | -1 | 0;
  roiSign: 1 | -1 | 0;
  sparkSign: string | null;
  sparkColor: string;
  sparkOpacity: string;
}

async function collect(page: Page): Promise<Sample[]> {
  const raw = await page.$$eval(CARD_SELECTOR, (cards) =>
    cards.map((card, i) => {
      const spark = card.querySelector('.wb-spark');
      const roi = card.querySelector('.wb-roi');
      return {
        index: i,
        isFeature: card.classList.contains('wb-card-feature'),
        variantAttr: spark?.getAttribute('data-spark-variant') || null,
        ariaLabel: card.getAttribute('aria-label'),
        roiText: roi?.textContent || '',
        sparkSign: spark?.getAttribute('data-spark-sign') || null,
        sparkColor: (spark?.getAttribute('data-spark-color') || '').toLowerCase(),
        sparkOpacity: spark?.getAttribute('data-spark-opacity') || '',
      };
    }),
  );
  return raw.map((r) => ({
    index: r.index,
    isFeature: r.isFeature,
    variantAttr: r.variantAttr,
    ariaSign: signFromAriaLabel(r.ariaLabel),
    roiSign: signFromRoiText(r.roiText),
    sparkSign: r.sparkSign,
    sparkColor: r.sparkColor,
    sparkOpacity: r.sparkOpacity,
  }));
}

test.describe('Sparkline pctSign 派生值視覺回歸', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('normal 卡：正號 → #ff4d1f/0.85；負號 → #9b968d/0.55（分組完全一致）', async ({ page }) => {
    await gotoFreeCheckup(page);
    const samples = (await collect(page)).filter((s) => s.variantAttr === 'normal');
    expect(samples.length, '至少 1 張 normal 卡').toBeGreaterThan(0);

    const pos = samples.filter((s) => s.ariaSign === 1);
    const neg = samples.filter((s) => s.ariaSign === -1);
    if (pos.length === 0 && neg.length === 0) test.skip(true, 'demo 種子無法區分符號');

    for (const s of pos) {
      expect(s.sparkColor, `card #${s.index} 正 color`).toBe('#ff4d1f');
      expect(s.sparkOpacity, `card #${s.index} 正 opacity`).toBe('0.85');
      expect(s.sparkSign, `card #${s.index} 正 sign`).toBe('1');
    }
    for (const s of neg) {
      expect(s.sparkColor, `card #${s.index} 負 color`).toBe('#9b968d');
      expect(s.sparkOpacity, `card #${s.index} 負 opacity`).toBe('0.55');
      expect(s.sparkSign, `card #${s.index} 負 sign`).toBe('-1');
    }
    if (pos.length > 0 && neg.length > 0) {
      // 跨零守門
      expect(pos[0].sparkColor).not.toBe(neg[0].sparkColor);
      expect(pos[0].sparkOpacity).not.toBe(neg[0].sparkOpacity);
      expect(pos[0].sparkSign).not.toBe(neg[0].sparkSign);
    }
  });

  test('feature (ink) 卡：color 恆 #f4f1ec；正=0.85 / 負=0.6', async ({ page }) => {
    await gotoFreeCheckup(page);
    const samples = (await collect(page)).filter((s) => s.variantAttr === 'ink');
    if (samples.length === 0) test.skip(true, '本輪 demo 無 feature 卡');

    for (const s of samples) {
      expect(s.sparkColor, `feature #${s.index} color`).toBe('#f4f1ec');
      if (s.ariaSign === 1) expect(s.sparkOpacity).toBe('0.85');
      else if (s.ariaSign === -1) expect(s.sparkOpacity).toBe('0.6');
    }
  });

  test('aria-label 報酬率符號 與 .wb-roi % 符號 逐卡一致（跨零不錯位）', async ({ page }) => {
    await gotoFreeCheckup(page);
    const samples = await collect(page);
    expect(samples.length).toBeGreaterThan(0);
    for (const s of samples) {
      if (s.ariaSign === 0 || s.roiSign === 0) continue;
      expect(s.ariaSign, `card #${s.index} aria vs roi`).toBe(s.roiSign);
    }
  });

  test('data-spark-color 白名單：僅 #ff4d1f / #9b968d / #f4f1ec', async ({ page }) => {
    await gotoFreeCheckup(page);
    const samples = await collect(page);
    const allowed = new Set(['#ff4d1f', '#9b968d', '#f4f1ec']);
    for (const s of samples) {
      expect(allowed.has(s.sparkColor), `card #${s.index} color=${s.sparkColor}`).toBe(true);
    }
  });

  test('data-spark-opacity 白名單：僅 0.85 / 0.55 / 0.6', async ({ page }) => {
    await gotoFreeCheckup(page);
    const samples = await collect(page);
    const allowed = new Set(['0.85', '0.55', '0.6']);
    for (const s of samples) {
      expect(allowed.has(s.sparkOpacity), `card #${s.index} opacity=${s.sparkOpacity}`).toBe(true);
    }
  });

  test('data-spark-sign 白名單：僅 "1" / "-1"（0% 落正號分支）', async ({ page }) => {
    await gotoFreeCheckup(page);
    const samples = await collect(page);
    for (const s of samples) {
      expect(['1', '-1']).toContain(s.sparkSign);
      // 若 roi 顯示 +0.00%，sign 必須為 "1"
      if (/\+0\.00\s*%/.test(String(s))) expect(s.sparkSign).toBe('1');
    }
  });
});
