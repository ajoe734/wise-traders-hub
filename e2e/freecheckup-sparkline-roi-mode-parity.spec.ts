import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { navigateAndWaitForCardReady } from './helpers/navigation';

/**
 * Demo × Real 兩模式的 sparkline / ROI 派生值 parity 回歸。
 *
 * 目的：無論資料來自 demo seed 還是登入後的雲端持倉，只要 Header 收到
 * 相同的 (pct, isFeature, isInk) 三元組，`data-spark-*` 屬性、`.wb-roi`
 * 文字、`aria-label` 的符號都必須一致。這守住 seed 或 backfill 改寫時
 * 兩條資料路徑派生分支意外漂移的風險。
 *
 * 範疇（依 mem://qa/checkup/freecheckup-mobile-regression-checklist）：
 *   Case 1 Demo baseline 白名單 —— color / opacity / sign / aria vs roi
 *   Case 2 Real  baseline 白名單 —— 同上（需 injected session；否則 skip）
 *   Case 3 Demo × Real 逐卡 parity —— code 對齊後 variant / sign / color /
 *          opacity / roiText / aria 逐項全等
 *   Case 4 跨零守門 —— 正負兩群 color / opacity 互異（兩模式各跑一次）
 *   Case 5 Feature (ink) 卡 —— color 恆 #f4f1ec；正=0.85 / 負=0.6
 *
 * 環境備註：
 *   - Headless Chromium 的 IntersectionObserver 不會自動 fire，統一在
 *     addInitScript 把 observe 視為 intersecting，避免 Header 卡 skeleton。
 *   - Real mode 靠 LOVABLE_BROWSER_SUPABASE_* 環境變數還原 session；為避免
 *     等雲端回種資料，會把 demo seed 預先寫入 `pf-holdings-v2` localStorage
 *     當離線 fallback。若還原後 0 張卡，視為「該帳號無持倉」直接 skip 該
 *     測試，不硬造假 pass。
 *   - `?demo=1` 走 CheckupModeProvider 的 forceDemo 分支；不設就依 auth。
 */

const ROUTE = '/holding-checkup';
const CARD_SELECTOR = '.holdings-card-grid .wb-card';
const AUTH_STATUS = process.env.LOVABLE_BROWSER_AUTH_STATUS || '';
const AUTH_INJECTED = AUTH_STATUS === 'injected';

// ─── demo seed（與 src/checkup/seedData.js INIT_HOLDINGS 對齊，只留 Header 需要
// 的欄位）。這裡刻意用 pnl>0 / pnl<0 / pnl≈0 三種樣本，方便跨零守門。 ───
const SEED_HOLDINGS = [
  { code: '2330', name: '台積電', qty: 1000, cost: 500, price: 950, value: 950000, pnl: 450000, pct: 90, feature: true },
  { code: '2454', name: '聯發科', qty: 500, cost: 900, price: 1200, value: 600000, pnl: 150000, pct: 33.33 },
  { code: '2317', name: '鴻海', qty: 2000, cost: 200, price: 180, value: 360000, pnl: -40000, pct: -10 },
  { code: '00631L', name: '元大台灣50正2', qty: 5000, cost: 130, price: 120, value: 600000, pnl: -50000, pct: -7.69 },
];

async function installIOStub(page: Page) {
  await page.addInitScript(() => {
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
}

async function bootDemo(page: Page) {
  await installIOStub(page);
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('checkup-demo-mode', '1');
      window.localStorage.setItem('holdings-intro-video-seen-v2', '1');
      window.sessionStorage.setItem('holdings-intro-video-dismissed-session', '1');
      window.sessionStorage.setItem('lf_force_demo', '1');
    } catch {}
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

async function restoreSupabaseSession(page: Page, context: BrowserContext) {
  const cookiesJson = process.env.LOVABLE_BROWSER_SUPABASE_COOKIES_JSON;
  const storageKey = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;
  const sessionJson = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
  if (cookiesJson) {
    const cookies = JSON.parse(cookiesJson).map((c: any) => ({ ...c, url: 'http://localhost:8080' }));
    await context.addCookies(cookies);
  }
  await page.goto('http://localhost:8080');
  if (storageKey && sessionJson) {
    await page.evaluate(
      ([k, v]) => window.localStorage.setItem(k as string, v as string),
      [storageKey, sessionJson],
    );
  }
}

async function bootReal(page: Page, context: BrowserContext) {
  if (!AUTH_INJECTED) test.skip(true, `real mode 需 injected session；目前 AUTH_STATUS=${AUTH_STATUS || 'unset'}`);
  await installIOStub(page);
  await restoreSupabaseSession(page, context);
  // 把 demo seed 預先寫進 pf-holdings-v2，離線 fallback / 首次載入時直接吃這份，
  // 避免依賴雲端種資料。若載入邏輯覆蓋掉，稍後 collect() 會偵測 0 卡並 skip。
  await page.evaluate((rows) => {
    try {
      window.localStorage.setItem('pf-holdings-v2', JSON.stringify(rows));
      window.localStorage.setItem('holdings-intro-video-seen-v2', '1');
      window.sessionStorage.setItem('holdings-intro-video-dismissed-session', '1');
      window.sessionStorage.removeItem('lf_force_demo');
    } catch {}
  }, SEED_HOLDINGS);
  await navigateAndWaitForCardReady(page, ROUTE + '?demo=0', {
    cardSelector: CARD_SELECTOR,
    selectorTimeoutMs: 30_000,
  });
  await page.waitForFunction(
    () => document.querySelectorAll('.holdings-card-grid .wb-card .wb-spark').length > 0,
    null,
    { timeout: 8_000 },
  ).catch(() => {});
}

function signFromAriaLabel(label: string | null): 1 | -1 | 0 {
  if (!label) return 0;
  const m = label.match(/報酬率\s*([+\-]?)([\d.]+)/);
  if (!m || !Number.isFinite(Number(m[2]))) return 0;
  return m[1] === '-' ? -1 : 1;
}
function signFromRoiText(txt: string | null): 1 | -1 | 0 {
  if (!txt) return 0;
  const m = txt.match(/([+\-])?(\d+\.\d+)\s*%/);
  if (!m) return 0;
  return m[1] === '-' ? -1 : 1;
}

interface Sample {
  index: number;
  code: string;
  isFeature: boolean;
  variantAttr: string | null;
  ariaLabel: string;
  roiText: string;
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
      // code 優先讀 data-code，否則從第一個含 4-6 位數字或帶字母尾的 span 撈
      let code = card.getAttribute('data-code') || '';
      if (!code) {
        const spans = Array.from(card.querySelectorAll('span'));
        for (const s of spans) {
          const t = (s.textContent || '').trim();
          if (/^\d{4,6}[A-Z]?$/.test(t)) { code = t; break; }
        }
      }
      return {
        index: i,
        code,
        isFeature: card.classList.contains('wb-card-feature'),
        variantAttr: spark?.getAttribute('data-spark-variant') || null,
        ariaLabel: card.getAttribute('aria-label') || '',
        roiText: roi?.textContent || '',
        sparkSign: spark?.getAttribute('data-spark-sign') || null,
        sparkColor: (spark?.getAttribute('data-spark-color') || '').toLowerCase(),
        sparkOpacity: spark?.getAttribute('data-spark-opacity') || '',
      };
    }),
  );
  return raw.map((r) => ({
    ...r,
    ariaSign: signFromAriaLabel(r.ariaLabel),
    roiSign: signFromRoiText(r.roiText),
  }));
}

function assertWhitelist(samples: Sample[], modeLabel: string) {
  const colors = new Set(['#ff4d1f', '#9b968d', '#f4f1ec']);
  const opacities = new Set(['0.85', '0.55', '0.6']);
  const signs = new Set(['1', '-1']);
  expect(samples.length, `${modeLabel}: 至少 1 張卡`).toBeGreaterThan(0);
  for (const s of samples) {
    expect(colors.has(s.sparkColor), `${modeLabel} #${s.index}(${s.code}) color=${s.sparkColor}`).toBe(true);
    expect(opacities.has(s.sparkOpacity), `${modeLabel} #${s.index}(${s.code}) opacity=${s.sparkOpacity}`).toBe(true);
    expect(signs.has(s.sparkSign || ''), `${modeLabel} #${s.index}(${s.code}) sign=${s.sparkSign}`).toBe(true);
    if (s.ariaSign !== 0 && s.roiSign !== 0) {
      expect(s.ariaSign, `${modeLabel} #${s.index}(${s.code}) aria vs roi`).toBe(s.roiSign);
    }
  }
}

function assertCrossZero(samples: Sample[], modeLabel: string) {
  const pos = samples.filter((s) => s.sparkSign === '1');
  const neg = samples.filter((s) => s.sparkSign === '-1');
  if (pos.length === 0 || neg.length === 0) {
    test.skip(true, `${modeLabel}: 缺正/負樣本，無法跨零守門`);
  }
  const posColors = new Set(pos.map((s) => s.sparkColor));
  const negColors = new Set(neg.map((s) => s.sparkColor));
  for (const c of posColors) expect(negColors.has(c), `${modeLabel} 正負色重疊: ${c}`).toBe(false);
  const posOps = new Set(pos.map((s) => s.sparkOpacity));
  const negOps = new Set(neg.map((s) => s.sparkOpacity));
  // ink 正=0.85、負=0.6；normal 正=0.85、負=0.55。0.85 會在兩側都出現 iff
  // 兩側同時含 ink（正）與 normal（正）— 但我們只斷言不會 100% 重疊。
  expect([...posOps].some((o) => !negOps.has(o)) || [...negOps].some((o) => !posOps.has(o)),
    `${modeLabel} 正負 opacity 完全重疊`).toBe(true);
}

function assertInk(samples: Sample[], modeLabel: string) {
  const ink = samples.filter((s) => s.variantAttr === 'ink');
  if (ink.length === 0) return; // 非強制存在
  for (const s of ink) {
    expect(s.sparkColor, `${modeLabel} ink #${s.index} color`).toBe('#f4f1ec');
    if (s.ariaSign === 1) expect(s.sparkOpacity, `${modeLabel} ink #${s.index} +opacity`).toBe('0.85');
    else if (s.ariaSign === -1) expect(s.sparkOpacity, `${modeLabel} ink #${s.index} -opacity`).toBe('0.6');
  }
}

test.describe('Demo × Real 兩模式 sparkline / ROI 派生一致性', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Case 1 — demo baseline 白名單 + aria/roi 符號一致', async ({ page }) => {
    await bootDemo(page);
    const samples = await collect(page);
    assertWhitelist(samples, 'demo');
  });

  test('Case 2 — real baseline 白名單 + aria/roi 符號一致', async ({ page, context }) => {
    await bootReal(page, context);
    const samples = await collect(page);
    if (samples.length === 0) test.skip(true, 'real 帳號無持倉，跳過 baseline');
    assertWhitelist(samples, 'real');
  });

  test('Case 3 — demo × real 逐 code parity（variant/sign/color/opacity/roi/aria）', async ({ page, context, browser }) => {
    if (!AUTH_INJECTED) test.skip(true, `real mode 需 injected session；目前 AUTH_STATUS=${AUTH_STATUS || 'unset'}`);

    await bootDemo(page);
    const demoSamples = await collect(page);
    const demoByCode = new Map(demoSamples.filter((s) => s.code).map((s) => [s.code, s]));

    // 開新 context 避免 demo/real localStorage 互相污染
    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page2 = await ctx2.newPage();
    try {
      await bootReal(page2, ctx2);
      const realSamples = await collect(page2);
      if (realSamples.length === 0) test.skip(true, 'real 帳號無持倉，跳過 parity');

      let compared = 0;
      for (const r of realSamples) {
        if (!r.code) continue;
        const d = demoByCode.get(r.code);
        if (!d) continue;
        compared++;
        expect(r.variantAttr, `code ${r.code} variant`).toBe(d.variantAttr);
        expect(r.sparkSign, `code ${r.code} sign`).toBe(d.sparkSign);
        expect(r.sparkColor, `code ${r.code} color`).toBe(d.sparkColor);
        expect(r.sparkOpacity, `code ${r.code} opacity`).toBe(d.sparkOpacity);
        expect(r.isFeature, `code ${r.code} feature flag`).toBe(d.isFeature);
        // roi 文字（±X.XX%）與 aria 符號段全等
        const roiFragR = (r.roiText.match(/[+\-]?\d+\.\d+\s*%/) || [''])[0].replace(/\s+/g, '');
        const roiFragD = (d.roiText.match(/[+\-]?\d+\.\d+\s*%/) || [''])[0].replace(/\s+/g, '');
        expect(roiFragR, `code ${r.code} roi text`).toBe(roiFragD);
        const ariaFragR = (r.ariaLabel.match(/報酬率\s*[+\-]?\d+(\.\d+)?/) || [''])[0].replace(/\s+/g, '');
        const ariaFragD = (d.ariaLabel.match(/報酬率\s*[+\-]?\d+(\.\d+)?/) || [''])[0].replace(/\s+/g, '');
        if (ariaFragR && ariaFragD) expect(ariaFragR, `code ${r.code} aria`).toBe(ariaFragD);
      }
      expect(compared, '至少 1 對 code 可比對').toBeGreaterThan(0);
    } finally {
      await ctx2.close();
    }
  });

  test('Case 4 — demo 跨零守門（正/負 color & opacity 不重疊）', async ({ page }) => {
    await bootDemo(page);
    const samples = await collect(page);
    assertCrossZero(samples, 'demo');
  });

  test('Case 4b — real 跨零守門', async ({ page, context }) => {
    await bootReal(page, context);
    const samples = await collect(page);
    if (samples.length === 0) test.skip(true, 'real 帳號無持倉');
    assertCrossZero(samples, 'real');
  });

  test('Case 5 — demo ink 卡：color=#f4f1ec，正=0.85 / 負=0.6', async ({ page }) => {
    await bootDemo(page);
    const samples = await collect(page);
    assertInk(samples, 'demo');
  });

  test('Case 5b — real ink 卡', async ({ page, context }) => {
    await bootReal(page, context);
    const samples = await collect(page);
    if (samples.length === 0) test.skip(true, 'real 帳號無持倉');
    assertInk(samples, 'real');
  });
});
