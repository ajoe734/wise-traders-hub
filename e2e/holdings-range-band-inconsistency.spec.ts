/**
 * E2E — RangeBand 資料源一致性偵測（§4.6 30D 走勢帶）
 *
 * 透過 preview-only harness `/e2e/range-band-harness` 注入受控的
 * price / spark / low / high，驗證：
 *   1. SPARK_VS_PRICE_DRIFT（現價 vs 折線末值 > 3%）→ 出現琥珀色警示點 + data-inconsistent="1"
 *   2. PRICE_OUT_OF_RANGE（現價超出 [low, high]） → 警示點觸發 + code 正確
 *   3. SPARK_OUT_OF_RANGE（折線末值超出 [low, high]） → 警示點觸發 + code 正確
 *   4. 多重不一致同時觸發，data-inconsistent-codes 包含所有 code
 *   5. 正常一致資料 → 不出現警示點、無 data-inconsistent
 *   6. 警示點的 title / aria-label 內含對應 code（可觸讀）
 *   7. 分析埋點 `holdings_range_band_inconsistency` 只針對不一致情境送出
 */
import { test, expect, type Page } from '@playwright/test';

type Fixture = {
  price?: number;
  low?: number;
  high?: number;
  spark?: number[];
  ohlc?: { open: number; high: number; low: number; close: number; date?: string }[];
  symbol?: string;
  priceSource?: string;
  priceUpdatedAt?: string;
};


function encodeFixture(fx: Fixture): string {
  const json = JSON.stringify(fx);
  const b64 = Buffer.from(unescape(encodeURIComponent(json)), 'binary').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function installFunnelSink(page: Page) {
  await page.addInitScript(() => {
    (window as any).__funnelEvents = [] as any[];
    const sink = (window as any).__funnelEvents as any[];
    const ingest = (body: any) => {
      try {
        const text = typeof body === 'string' ? body : '';
        if (!text) return;
        sink.push(JSON.parse(text));
      } catch {
        /* ignore */
      }
    };
    const origBeacon = navigator.sendBeacon?.bind(navigator);
    navigator.sendBeacon = ((url: string, data?: BodyInit | null) => {
      if (typeof url === 'string' && url.includes('/functions/v1/traffic-ingest')) {
        if (data && typeof (data as Blob).text === 'function') {
          (data as Blob).text().then(ingest).catch(() => {});
        } else {
          ingest(data as string | undefined);
        }
        return true;
      }
      return origBeacon ? origBeacon(url, data as any) : true;
    }) as typeof navigator.sendBeacon;
    const origFetch = window.fetch.bind(window);
    window.fetch = ((...args: Parameters<typeof fetch>) => {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;
      if (url.includes('/functions/v1/traffic-ingest')) {
        const init = args[1] as RequestInit | undefined;
        ingest(init?.body as string | undefined);
        return Promise.resolve(new Response('{}', { status: 200 }));
      }
      return origFetch(...args);
    }) as typeof fetch;
  });
}

async function gotoFixture(page: Page, fx: Fixture) {
  await page.goto(`/e2e/range-band-harness?d=${encodeFixture(fx)}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.locator('[data-testid="holdings-range-band"]').waitFor({
    state: 'visible',
    timeout: 10_000,
  });
}

test.describe('RangeBand 資料源一致性偵測 (mock 分歧)', () => {
  test.use({ viewport: { width: 640, height: 480 } });

  test.beforeEach(async ({ page }) => {
    await installFunnelSink(page);
  });

  test('SPARK_VS_PRICE_DRIFT：現價偏離折線末值 > 3% → 顯示琥珀警示', async ({ page }) => {
    // spark 末值 100，price 110 → drift 10%
    await gotoFixture(page, {
      symbol: 'TEST-DRIFT',
      price: 110,
      low: 95,
      high: 115,
      spark: [95, 97, 96, 99, 100],
      priceSource: 'yahoo',
    });

    const band = page.locator('[data-testid="holdings-range-band"]');
    await expect(band).toHaveAttribute('data-inconsistent', '1');
    const codes = await band.getAttribute('data-inconsistent-codes');
    expect(codes).toContain('SPARK_VS_PRICE_DRIFT');

    const warn = page.locator('[data-testid="holdings-range-band-warn"]');
    await expect(warn).toBeVisible();
    const title = await warn.getAttribute('title');
    expect(title).toContain('SPARK_VS_PRICE_DRIFT');
    const aria = await warn.getAttribute('aria-label');
    expect(aria).toContain('SPARK_VS_PRICE_DRIFT');
  });

  test('PRICE_OUT_OF_RANGE：現價超出 [low, high] → 警示點觸發', async ({ page }) => {
    // price 200 遠超 high 105
    await gotoFixture(page, {
      symbol: 'TEST-PRICE-OUT',
      price: 200,
      low: 95,
      high: 105,
      spark: [100, 101, 102, 100, 101],
      priceSource: 'twse',
    });

    const band = page.locator('[data-testid="holdings-range-band"]');
    await expect(band).toHaveAttribute('data-inconsistent', '1');
    const codes = await band.getAttribute('data-inconsistent-codes');
    expect(codes).toContain('PRICE_OUT_OF_RANGE');
    await expect(page.locator('[data-testid="holdings-range-band-warn"]')).toBeVisible();
  });

  test('SPARK_OUT_OF_RANGE：折線末值超出 [low, high] → 警示點觸發', async ({ page }) => {
    // spark 末值 500 遠超 high 110；price 對齊末值避免額外觸發 DRIFT
    await gotoFixture(page, {
      symbol: 'TEST-SPARK-OUT',
      price: 500,
      low: 95,
      high: 110,
      spark: [100, 101, 102, 300, 500],
      priceSource: 'live',
    });

    const band = page.locator('[data-testid="holdings-range-band"]');
    await expect(band).toHaveAttribute('data-inconsistent', '1');
    const codes = await band.getAttribute('data-inconsistent-codes');
    expect(codes).toContain('SPARK_OUT_OF_RANGE');
    // price 遠超 hi → 也會同時 fire PRICE_OUT_OF_RANGE
    expect(codes).toContain('PRICE_OUT_OF_RANGE');
    await expect(page.locator('[data-testid="holdings-range-band-warn"]')).toBeVisible();
  });

  test('一致資料（現價貼齊折線末值且落於區間內）→ 不觸發警示、無 data-inconsistent', async ({
    page,
  }) => {
    await gotoFixture(page, {
      symbol: 'TEST-CLEAN',
      price: 100.5,
      low: 95,
      high: 105,
      spark: [98, 99, 100, 100.2, 100.5],
      priceSource: 'yahoo',
    });

    const band = page.locator('[data-testid="holdings-range-band"]');
    const attr = await band.getAttribute('data-inconsistent');
    expect(attr).toBeNull();
    const codes = await band.getAttribute('data-inconsistent-codes');
    expect(codes).toBeNull();
    await expect(page.locator('[data-testid="holdings-range-band-warn"]')).toHaveCount(0);
  });

  test('多重不一致同時觸發：data-inconsistent-codes 應包含全部 code', async ({ page }) => {
    // price 200：超出 [95, 110] → PRICE_OUT_OF_RANGE；vs spark 末值 100 差 100% → DRIFT
    // spark 末值 100：在 [95, 110] 內，不會 SPARK_OUT_OF_RANGE
    await gotoFixture(page, {
      symbol: 'TEST-MULTI',
      price: 200,
      low: 95,
      high: 110,
      spark: [98, 99, 100, 100, 100],
    });

    const band = page.locator('[data-testid="holdings-range-band"]');
    await expect(band).toHaveAttribute('data-inconsistent', '1');
    const codes = (await band.getAttribute('data-inconsistent-codes')) || '';
    expect(codes.split(',')).toEqual(
      expect.arrayContaining(['SPARK_VS_PRICE_DRIFT', 'PRICE_OUT_OF_RANGE']),
    );
    const warn = page.locator('[data-testid="holdings-range-band-warn"]');
    await expect(warn).toBeVisible();
    // 警示點 title 應包含至少兩個 code（以逗號或空白分隔）
    const title = (await warn.getAttribute('title')) || '';
    expect(title).toContain('SPARK_VS_PRICE_DRIFT');
    expect(title).toContain('PRICE_OUT_OF_RANGE');
  });

  test('偵測到不一致時推入 window.__rangeBandDiagnostics（含 code / symbol / priceSource）', async ({
    page,
  }) => {
    // 一致資料：陣列應為空或不存在
    await gotoFixture(page, {
      symbol: 'TEST-EVT-CLEAN',
      price: 100,
      low: 95,
      high: 105,
      spark: [99, 100, 100, 100, 100],
      priceSource: 'yahoo',
    });
    await page.waitForTimeout(300);
    let diags: any[] = await page.evaluate(
      () => (window as any).__rangeBandDiagnostics || [],
    );
    expect(diags).toHaveLength(0);

    // 分歧資料（同 page 內導向 → window 重建）
    await gotoFixture(page, {
      symbol: 'TEST-EVT-DIVERGE',
      price: 200,
      low: 95,
      high: 110,
      spark: [98, 99, 100, 100, 100],
      priceSource: 'twse',
    });
    await page.waitForTimeout(400);
    diags = await page.evaluate(
      () => (window as any).__rangeBandDiagnostics || [],
    );
    expect(diags.length).toBeGreaterThanOrEqual(1);
    const codes = diags.map((d) => d.code);
    expect(codes).toEqual(
      expect.arrayContaining(['SPARK_VS_PRICE_DRIFT', 'PRICE_OUT_OF_RANGE']),
    );
    // payload 必要欄位
    for (const d of diags) {
      expect(d.symbol).toBe('TEST-EVT-DIVERGE');
      expect(d.priceSource).toBe('twse');
    }
  });

  test('OHLC 優先：提供 ohlc 時以 K 線蠟燭渲染，並以末根 close 做一致性偵測', async ({ page }) => {
    await gotoFixture(page, {
      symbol: 'TEST-KLINE',
      price: 95,
      low: 90,
      high: 110,
      ohlc: [
        { open: 100, high: 105, low: 98, close: 102 },
        { open: 102, high: 104, low: 97, close: 98 },
        { open: 98, high: 100, low: 94, close: 96 },
      ],
      priceSource: 'twse',
    });

    const band = page.locator('[data-testid="holdings-range-band"]');
    // K 線模式：應有蠟燭 rect（實體）+ 上下影線 line
    await expect(band.locator('[data-testid="kline-candle"]')).toHaveCount(3);
    await expect(band.locator('[data-testid="kline-wick"]')).toHaveCount(3);
    // 末根 close 96 對比現價 95 → 差距 ≈1%，不應觸發 drift
    const attr = await band.getAttribute('data-inconsistent');
    expect(attr).toBeNull();
  });

  test('OHLC 不足時退回折線圖（polyline）維持原有一致性行為', async ({ page }) => {
    await gotoFixture(page, {
      symbol: 'TEST-FALLBACK',
      price: 95,
      low: 90,
      high: 110,
      spark: [98, 99, 100, 100, 96],
      ohlc: [],
      priceSource: 'twse',
    });

    const band = page.locator('[data-testid="holdings-range-band"]');
    // 折線模式：應有 polyline 而無蠟燭
    await expect(band.locator('svg > polyline')).toHaveCount(1);
    await expect(band.locator('[data-testid="kline-candle"]')).toHaveCount(0);
  });
});

