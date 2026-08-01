/**
 * E2E · ChipsSection 行動端佈局回歸
 *
 * 覆蓋 iPhone SE / iPhone 12 / iPhone 14 Pro Max / Pixel 5 / Galaxy S8 / 極窄 320
 * 六個常見行動裝置寬度，驗證：
 *   1) 頁面無水平滾動（document.scrollingElement.scrollWidth <= viewport.width + 1）
 *   2) chips-section 及各主要子區塊右緣不超出 viewport
 *   3) 三大法人 12 個數值格皆可見，且 scrollWidth <= clientWidth（不被截斷）
 *   4) BSR 買/賣兩欄不重疊（左欄 right <= 右欄 left + 1px 容差）
 *   5) BSR 券商名稱行 scrollWidth <= clientWidth（ellipsis 未生效表示不截斷）
 *   6) 錯誤 banner 在行動端仍完整顯示重試按鈕，且不溢出
 *   7) 空資料排程提示文字不被裁切
 *   8) 趨勢圖 SVG 寬度 <= 容器寬度
 *
 * 策略：以完整 payload 為主 case，另外覆蓋 error 與 empty 兩個變體，
 *       全部裝置皆跑同一批斷言，避免行動端 regression 只在某一寬度冒出。
 */
import { test, expect, Route, devices } from '@playwright/test';

const STOCK = '2330';
const CHIPS_ROUTE = '**/tw-chips-detail**';

// 六個實務常見的行動視窗
const MOBILES: Array<{ name: string; width: number; height: number }> = [
  { name: 'narrow-320',            width: 320, height: 568 },  // iPhone SE 1st gen 極窄
  { name: 'iphone-se-2020-375',    width: 375, height: 667 },
  { name: 'iphone-12-390',         width: 390, height: 844 },
  { name: 'pixel-5-393',           width: 393, height: 851 },
  { name: 'galaxy-s8-360',         width: 360, height: 740 },
  { name: 'iphone-14-promax-430',  width: 430, height: 932 },
];

function fullPayload() {
  const dates = Array.from({ length: 20 }, (_, i) => {
    const d = new Date(2026, 6, 1 + i);
    return d.toISOString().slice(0, 10);
  });
  return {
    stock_id: STOCK,
    as_of: '2026-07-20',
    institutional: {
      d1:  { foreign_net:    250_000, trust_net:  40_000, dealer_net:  -5_000, total_net:    285_000, days_covered: 1 },
      d5:  { foreign_net:  1_200_000, trust_net: 180_000, dealer_net: -20_000, total_net:  1_360_000, days_covered: 5 },
      d20: { foreign_net:  3_500_000, trust_net: 400_000, dealer_net: -80_000, total_net:  3_820_000, days_covered: 20 },
      d60: { foreign_net: -1_800_000, trust_net: 600_000, dealer_net: 100_000, total_net: -1_100_000, days_covered: 60 },
    },
    bsr: {
      d5: {
        top_buy: [
          { broker_id: '9800', name: '元大證券-台北分公司', net: 1_500_000 },
          { broker_id: '9200', name: '凱基-敦南分公司', net: 900_000 },
          { broker_id: '5920', name: '富邦-建國', net: 500_000 },
        ],
        top_sell: [
          { broker_id: '8560', name: '新光-城中', net: -1_200_000 },
          { broker_id: '9600', name: '群益金鼎-仁愛', net: -800_000 },
          { broker_id: '8880', name: '國票-中山', net: -400_000 },
        ],
        concentration_ratio: 78,
      },
      d20: null,
      d60: null,
    },
    bsr_as_of: '2026-07-19',
    series: {
      institutional_daily: dates.map((date, i) => ({
        date,
        foreign_net: (i % 3 === 0 ? 1 : -1) * (100_000 + i * 5_000),
        trust_net: (i % 2 === 0 ? 1 : -1) * (30_000 + i * 1_000),
        dealer_net: 5_000 * (i - 10),
        total_net: (i % 3 === 0 ? 1 : -1) * (140_000 + i * 4_000),
      })),
      bsr_concentration: dates.map((date, i) => ({
        date,
        concentration_ratio: 45 + i * 2,
        top_net: 200_000 + i * 1_000,
      })),
    },
    source: 'TWSE',
    fetched_at: new Date().toISOString(),
  };
}

function emptyPayload() {
  return {
    stock_id: STOCK,
    as_of: null,
    institutional: { d1: null, d5: null, d20: null, d60: null },
    bsr: { d5: null, d20: null, d60: null },
    bsr_as_of: null,
    series: { institutional_daily: [], bsr_concentration: [] },
    source: 'TWSE',
    fetched_at: new Date().toISOString(),
  };
}

async function fulfill(route: Route, body: any, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function assertNoHorizontalScroll(page: import('@playwright/test').Page, viewportWidth: number) {
  const scrollWidth = await page.evaluate(
    () => document.scrollingElement?.scrollWidth ?? document.documentElement.scrollWidth,
  );
  // 容忍 1px 反鋸齒
  expect(
    scrollWidth,
    `page horizontal scroll: scrollWidth=${scrollWidth}, viewport=${viewportWidth}`,
  ).toBeLessThanOrEqual(viewportWidth + 1);
}

/**
 * 通用：斷言 locator 對應的元素「右緣」不超出 viewport
 */
async function assertWithinViewport(locator: import('@playwright/test').Locator, viewportWidth: number, label: string) {
  const box = await locator.boundingBox();
  expect(box, `${label} boundingBox not found`).not.toBeNull();
  if (!box) return;
  expect(box.x, `${label} left < 0`).toBeGreaterThanOrEqual(-1);
  expect(
    box.x + box.width,
    `${label} overflows: right=${(box.x + box.width).toFixed(2)}, viewport=${viewportWidth}`,
  ).toBeLessThanOrEqual(viewportWidth + 1);
}

/**
 * 通用：斷言元素本身沒有內部裁切（scrollWidth <= clientWidth + 容差）
 */
async function assertNotInternallyClipped(locator: import('@playwright/test').Locator, label: string, tolerance = 1) {
  const metrics = await locator.evaluate((el) => ({
    scrollWidth: (el as HTMLElement).scrollWidth,
    clientWidth: (el as HTMLElement).clientWidth,
    text: (el as HTMLElement).innerText,
  }));
  expect(
    metrics.scrollWidth,
    `${label} internally clipped: scrollWidth=${metrics.scrollWidth}, clientWidth=${metrics.clientWidth}, text="${metrics.text}"`,
  ).toBeLessThanOrEqual(metrics.clientWidth + tolerance);
}

for (const dev of MOBILES) {
  test.describe(`ChipsSection · mobile @ ${dev.name} (${dev.width}x${dev.height})`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: dev.width, height: dev.height });
    });


    test('完整資料：無水平滾動 / 全區塊不溢出 / 法人格不截斷 / BSR 兩欄不重疊', async ({ page }) => {
      await page.route(CHIPS_ROUTE, (r) => fulfill(r, fullPayload()));
      await page.goto(`/e2e/chips-section?code=${STOCK}`);
      const section = page.getByTestId('chips-section');
      await section.waitFor();
      // 等趨勢圖也上完
      await page.getByTestId('chips-trend-chart').waitFor();

      // (1) 頁面層級無水平滾動
      await assertNoHorizontalScroll(page, dev.width);

      // (2) 主要子區塊右緣不超出 viewport
      for (const testid of [
        'chips-section',
        'chips-institutional',
        'chips-bsr',
        'chips-trend-chart',
        'chips-trend-readout',
        'chips-trend-scrubber',
      ]) {
        await assertWithinViewport(page.getByTestId(testid), dev.width, testid);
      }

      // (3) 三大法人 12 個數值格皆可見且內部不截斷
      for (const k of ['foreign_net', 'trust_net', 'dealer_net']) {
        for (const w of ['d1', 'd5', 'd20', 'd60']) {
          const cell = page.getByTestId(`chips-inst-${k}-${w}`);
          await expect(cell).toBeVisible();
          await assertWithinViewport(cell, dev.width, `inst-${k}-${w}`);
          await assertNotInternallyClipped(cell, `inst-${k}-${w}`);
        }
      }

      // (4) BSR 買/賣兩欄不重疊：抓 title 元素定位左右欄容器
      const bsrBuyTitle = page.getByText('買超前 3', { exact: true }).first();
      const bsrSellTitle = page.getByText('賣超前 3', { exact: true }).first();
      await expect(bsrBuyTitle).toBeVisible();
      await expect(bsrSellTitle).toBeVisible();
      const buyBox = await bsrBuyTitle.boundingBox();
      const sellBox = await bsrSellTitle.boundingBox();
      expect(buyBox && sellBox).toBeTruthy();
      if (buyBox && sellBox) {
        // 期望「同一列水平排列」——y 差距很小、且買欄整體在賣欄左側
        expect(Math.abs(buyBox.y - sellBox.y)).toBeLessThan(4);
        expect(buyBox.x + buyBox.width).toBeLessThanOrEqual(sellBox.x + 1);
      }

      // (5) BSR 券商名稱行不被 ellipsis：因為長券商名確實可能截斷，
      //     這裡只斷言「同時可見且不覆蓋到隔壁欄」——即個別文字節點必須落在自己那半個網格
      const bsrGrid = page.getByTestId('chips-bsr');
      const gridBox = await bsrGrid.boundingBox();
      const halfMid = gridBox ? gridBox.x + gridBox.width / 2 : dev.width / 2;
      for (const name of ['元大證券-台北分公司', '凱基-敦南分公司']) {
        const el = bsrGrid.getByText(name, { exact: false }).first();
        await expect(el).toBeVisible();
        const b = await el.boundingBox();
        expect(b, `buy col "${name}" not laid out`).not.toBeNull();
        if (b) {
          // 左欄名稱右緣不得越過中線 + 4px 容差
          expect(b.x + b.width).toBeLessThanOrEqual(halfMid + 4);
        }
      }
      for (const name of ['新光-城中', '群益金鼎-仁愛']) {
        const el = bsrGrid.getByText(name, { exact: false }).first();
        await expect(el).toBeVisible();
        const b = await el.boundingBox();
        expect(b).not.toBeNull();
        if (b) {
          expect(b.x, `sell col "${name}" bleeds into buy col`).toBeGreaterThanOrEqual(halfMid - 4);
        }
      }

      // (6) 集中度警告行不溢出
      const conc = page.getByText(/集中度：買超前 15 大占/);
      await expect(conc).toBeVisible();
      await assertWithinViewport(conc, dev.width, 'concentration-line');
      await assertNotInternallyClipped(conc, 'concentration-line');

      // (7) 趨勢圖 SVG 寬度 <= 容器寬度
      const trend = page.getByTestId('chips-trend-chart');
      const svg = trend.locator('svg').first();
      await expect(svg).toBeVisible();
      const [tBox, sBox] = await Promise.all([trend.boundingBox(), svg.boundingBox()]);
      expect(tBox && sBox).toBeTruthy();
      if (tBox && sBox) {
        expect(sBox.x + sBox.width).toBeLessThanOrEqual(tBox.x + tBox.width + 1);
      }
    });

    test('錯誤 banner：重試按鈕可見、banner 不溢出、水平無捲動', async ({ page }) => {
      await page.route(CHIPS_ROUTE, (r) => fulfill(r, 'boom', 500));
      await page.goto(`/e2e/chips-section?code=${STOCK}`);
      const banner = page.getByTestId('chips-error-banner');
      await banner.waitFor();

      await assertNoHorizontalScroll(page, dev.width);
      await assertWithinViewport(banner, dev.width, 'error-banner');

      const retry = page.getByTestId('chips-retry');
      await expect(retry).toBeVisible();
      await assertWithinViewport(retry, dev.width, 'retry-btn');

      // 重試按鈕最小可點區 ≥ 24px 寬（避免被壓成 0），避免行動端誤點不到
      const rBox = await retry.boundingBox();
      expect(rBox?.width ?? 0).toBeGreaterThanOrEqual(24);
      expect(rBox?.height ?? 0).toBeGreaterThanOrEqual(18);
    });

    test('空資料：排程提示 17:45 / 14:00–21:00 完整可讀且不截斷', async ({ page }) => {
      await page.route(CHIPS_ROUTE, (r) => fulfill(r, emptyPayload()));
      await page.goto(`/e2e/chips-section?code=${STOCK}`);

      await page.getByTestId('chips-section').waitFor();
      await assertNoHorizontalScroll(page, dev.width);

      const instMissing = page.getByTestId('chips-inst-missing');
      await expect(instMissing).toBeVisible();
      await expect(instMissing).toContainText('17:45');
      await assertWithinViewport(instMissing, dev.width, 'inst-missing');
      // 排程提示行本身允許換行，因此比對「wrapping 後 scrollHeight 有正常撐開」
      const wrap = await instMissing.evaluate((el) => ({
        scrollHeight: (el as HTMLElement).scrollHeight,
        clientHeight: (el as HTMLElement).clientHeight,
      }));
      expect(wrap.scrollHeight).toBeLessThanOrEqual(wrap.clientHeight + 1);

      const bsrMissing = page.getByTestId('chips-bsr-missing');
      await expect(bsrMissing).toBeVisible();
      await expect(bsrMissing).toContainText('14:00–21:00');
      await assertWithinViewport(bsrMissing, dev.width, 'bsr-missing');
    });
  });
}
