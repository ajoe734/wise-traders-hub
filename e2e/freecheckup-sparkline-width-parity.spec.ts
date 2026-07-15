import { test, expect, type Page } from '@playwright/test';
import { navigateAndWaitForCardReady } from './helpers/navigation';

/**
 * 跨寬度 sparkline 快照 + pctSign / sparkOpacity 屬性 parity 回歸。
 *
 * - Case A：每寬度對 `.wb-spark` 逐卡截圖，Playwright 依 project 分資料夾
 *   儲存基線（同 code 三種寬度各一張），守版面下的細節渲染。
 * - Case B：單一 project 內以 setViewportSize 逐寬度採樣，斷言同 code 的
 *   `data-spark-sign` / `data-spark-opacity` / `data-spark-variant` 完全一致。
 * - Case C：每寬度屬性白名單 + 跨零守門。
 *
 * 對應 project：sparkline-width-390 / 768 / 1280（見 playwright.config.ts）。
 */

const ROUTE = '/holding-checkup';
const CARD_SELECTOR = '.holdings-card-grid .wb-card';

async function bootDemo(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('checkup-demo-mode', '1');
      window.localStorage.setItem('holdings-intro-video-seen-v2', '1');
      window.sessionStorage.setItem('holdings-intro-video-dismissed-session', '1');
      window.sessionStorage.setItem('lf_force_demo', '1');
    } catch {}
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
  await navigateAndWaitForCardReady(page, ROUTE + '?demo=1', {
    cardSelector: CARD_SELECTOR,
    selectorTimeoutMs: 30_000,
  });
  await page.waitForFunction(
    () => document.querySelectorAll('.holdings-card-grid .wb-card .wb-spark').length > 0,
    null,
    { timeout: 8_000 },
  );
}

interface Sample {
  code: string;
  variantAttr: string | null;
  sparkSign: string | null;
  sparkColor: string;
  sparkOpacity: string;
}

async function collectByCode(page: Page): Promise<Map<string, Sample>> {
  const raw = await page.$$eval(CARD_SELECTOR, (cards) =>
    cards.map((card) => {
      const spark = card.querySelector('.wb-spark');
      let code = card.getAttribute('data-holding-code') || '';
      if (!code) {
        const spans = Array.from(card.querySelectorAll('span'));
        for (const s of spans) {
          const t = (s.textContent || '').trim();
          if (/^\d{4,6}[A-Z]?$/.test(t)) { code = t; break; }
        }
      }
      return {
        code,
        variantAttr: spark?.getAttribute('data-spark-variant') || null,
        sparkSign: spark?.getAttribute('data-spark-sign') || null,
        sparkColor: (spark?.getAttribute('data-spark-color') || '').toLowerCase(),
        sparkOpacity: spark?.getAttribute('data-spark-opacity') || '',
      };
    }),
  );
  return new Map(raw.filter((r) => r.code).map((r) => [r.code, r]));
}

const CURRENT_WIDTH = () => Number(process.env.__WIDTH_HINT__) || 0;

test.describe('Sparkline 跨寬度快照 + 屬性 parity', () => {
  test('Case A — 逐卡 .wb-spark element screenshot（每個 project 各存基線）', async ({ page }, testInfo) => {
    await bootDemo(page);
    const map = await collectByCode(page);
    expect(map.size, '至少 1 張有 code 的卡').toBeGreaterThan(0);

    for (const code of map.keys()) {
      const spark = page.locator(`${CARD_SELECTOR}[data-holding-code="${code}"] .wb-spark`).first();
      await expect(spark, `spark-${code} @ ${testInfo.project.name}`).toHaveScreenshot(
        `spark-${code}.png`,
        { maxDiffPixelRatio: 0.02, animations: 'disabled' },
      );
    }
  });

  test('Case B — 同 code 跨寬度 sparkSign / sparkOpacity / variant 全等', async ({ page }, testInfo) => {
    // 只在 390 project 執行一次；768/1280 project 跳過避免重工
    if (!testInfo.project.name.endsWith('-390')) {
      test.skip(true, 'DOM parity 僅需在 390 project 執行一次');
    }
    await bootDemo(page);

    const widths = [390, 768, 1280];
    const collected: Record<number, Map<string, Sample>> = {};
    for (const w of widths) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForFunction(
        () => document.querySelectorAll('.holdings-card-grid .wb-card .wb-spark').length > 0,
        null,
        { timeout: 8_000 },
      );
      // 讓 layout / observer 穩定
      await page.waitForTimeout(200);
      collected[w] = await collectByCode(page);
      expect(collected[w].size, `w=${w} 至少 1 張卡`).toBeGreaterThan(0);
    }

    const base = collected[390];
    let compared = 0;
    for (const [code, b] of base) {
      for (const w of [768, 1280]) {
        const s = collected[w].get(code);
        if (!s) continue;
        compared++;
        expect(s.sparkSign, `code=${code} w=${w} sign`).toBe(b.sparkSign);
        expect(s.sparkOpacity, `code=${code} w=${w} opacity`).toBe(b.sparkOpacity);
        expect(s.sparkColor, `code=${code} w=${w} color`).toBe(b.sparkColor);
        expect(s.variantAttr, `code=${code} w=${w} variant`).toBe(b.variantAttr);
      }
    }
    expect(compared, '至少 1 對 (code × 寬度) 完成比對').toBeGreaterThan(0);
  });

  test('Case C — 屬性白名單 + 跨零守門（每寬度各驗一次）', async ({ page }) => {
    await bootDemo(page);
    const samples = Array.from((await collectByCode(page)).values());
    expect(samples.length).toBeGreaterThan(0);

    const colors = new Set(['#ff4d1f', '#9b968d', '#f4f1ec']);
    const opacities = new Set(['0.85', '0.55', '0.6']);
    const signs = new Set(['1', '-1']);
    for (const s of samples) {
      expect(colors.has(s.sparkColor), `${s.code} color=${s.sparkColor}`).toBe(true);
      expect(opacities.has(s.sparkOpacity), `${s.code} opacity=${s.sparkOpacity}`).toBe(true);
      expect(signs.has(s.sparkSign || ''), `${s.code} sign=${s.sparkSign}`).toBe(true);
    }

    const pos = samples.filter((s) => s.sparkSign === '1');
    const neg = samples.filter((s) => s.sparkSign === '-1');
    if (pos.length === 0 || neg.length === 0) {
      test.skip(true, '本輪 demo 缺正/負樣本，跳過跨零守門');
    }
    const posColors = new Set(pos.map((s) => s.sparkColor));
    const negColors = new Set(neg.map((s) => s.sparkColor));
    for (const c of posColors) expect(negColors.has(c), `正負色重疊: ${c}`).toBe(false);
    const posOps = new Set(pos.map((s) => s.sparkOpacity));
    const negOps = new Set(neg.map((s) => s.sparkOpacity));
    expect(
      [...posOps].some((o) => !negOps.has(o)) || [...negOps].some((o) => !posOps.has(o)),
      '正負 opacity 完全重疊',
    ).toBe(true);
  });
});

// suppress unused warning if env hint helper is removed later
void CURRENT_WIDTH;
