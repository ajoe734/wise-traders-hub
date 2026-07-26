/**
 * E2E · ChipsSection 視覺回歸（screenshot diff）
 *
 * 目標：擋住「顏色 / 徽章（STALE / OFFLINE）/ 趨勢圖回放位置」在後續改版時
 *      不知不覺漂移。任何 palette 微調、boarder 樣式、圓點 fill / stroke
 *      都會被像素比對抓到。
 *
 * 覆蓋快照（皆固定 viewport 900x1400、DPR=2）：
 *   1. baseline          — 完整資料（含集中度警告紅字），trend 預設 5 日折線
 *   2. trend-1day-bars   — 切到 1 日 → 每日長條，正負雙色
 *   3. trend-bsr         — 切到分點集中度 → 70% 警戒虛線 + 灰主軸
 *   4. trend-playback-mid— scrubber 拉到中段 → 播放游標位置、圓點顏色
 *   5. badge-offline     — force=offline 觸發 OFFLINE badge + 離線 banner
 *   6. badge-stale       — force=stale 觸發 STALE badge（TTL 過期）
 *   7. error-500         — server 錯誤 banner 顏色（紅框粉底）
 *   8. empty-state       — 無資料 fallback 文案 + 排程提示
 *
 * 為了讓每次 CI 都跑出相同像素：
 *   - dates 用固定 2026/07/01~07/20，AS OF 2026/07/20
 *   - fetched_at 由 spec 傳固定 ISO；harness 額外 freezeTime=1 讓 Date.now 凍結
 *   - 「更新於 N 分鐘前」文字仍為動態 → 用 mask 遮掉
 *   - Scrubber thumb 為 Chromium native → mask 掉，只比對軌道
 */
import { test, expect, Route } from '@playwright/test';

const STOCK = '2330';
const CHIPS_ROUTE = '**/tw-chips-detail**';
const FROZEN_FETCHED_AT = '2026-07-20T09:30:00.000Z';

function fullPayload(overrides: Record<string, any> = {}) {
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
          { broker_id: '9800', name: '元大-台北', net: 1_500_000 },
          { broker_id: '9200', name: '凱基-敦南', net:   900_000 },
          { broker_id: '5920', name: '富邦-建國', net:   500_000 },
        ],
        top_sell: [
          { broker_id: '8560', name: '新光-城中',       net: -1_200_000 },
          { broker_id: '9600', name: '群益金鼎-仁愛',   net:   -800_000 },
          { broker_id: '8880', name: '國票-中山',       net:   -400_000 },
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
    fetched_at: FROZEN_FETCHED_AT,
    ...overrides,
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
    fetched_at: FROZEN_FETCHED_AT,
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

/**
 * 遮罩「更新於 X 分鐘前」（相對時間，會依 CI 執行時刻漂移）
 * 與 scrubber 原生 thumb（Chromium 版本差可能像素飄動）
 */
function dynamicMasks(page: import('@playwright/test').Page) {
  return [
    page.locator('text=/^更新於/'),
    page.getByTestId('chips-trend-scrubber'),
  ];
}

test.describe('ChipsSection · visual regression', () => {
  test.use({
    viewport: { width: 900, height: 1400 },
    // 固定 DPR 讓像素比對穩定
    deviceScaleFactor: 2,
  });

  test('1. baseline — 完整資料，trend 5 日折線', async ({ page }) => {
    await page.route(CHIPS_ROUTE, (r) => fulfill(r, fullPayload()));
    await page.goto(`/e2e/chips-section?code=${STOCK}&freezeTime=1`);
    const section = page.getByTestId('chips-section');
    await section.waitFor();
    await page.getByTestId('chips-trend-chart').waitFor();
    // 等 fonts + first paint 穩定
    await page.evaluate(() => (document as any).fonts?.ready);

    await expect(section).toHaveScreenshot('chips-baseline.png', {
      mask: dynamicMasks(page),
    });
  });

  // 「1 日」視窗已移除；柱體恆為每日淨買賣，改由 baseline 與其他斷點涵蓋


  test('3. trend 分點集中度 → 70% 警戒虛線', async ({ page }) => {
    await page.route(CHIPS_ROUTE, (r) => fulfill(r, fullPayload()));
    await page.goto(`/e2e/chips-section?code=${STOCK}&freezeTime=1`);
    await page.getByTestId('chips-trend-chart').waitFor();
    await page.getByRole('button', { name: '分點集中度' }).click();
    await page.evaluate(() => (document as any).fonts?.ready);

    await expect(page.getByTestId('chips-trend-chart')).toHaveScreenshot(
      'chips-trend-bsr.png',
      { mask: [page.getByTestId('chips-trend-scrubber')] },
    );
  });

  test('4. trend 播放游標拉到中段 → 圓點位置 / 顏色', async ({ page }) => {
    await page.route(CHIPS_ROUTE, (r) => fulfill(r, fullPayload()));
    await page.goto(`/e2e/chips-section?code=${STOCK}&freezeTime=1`);
    await page.getByTestId('chips-trend-chart').waitFor();
    // 把 scrubber 拉到 10（總長 19）— 用 native setter 觸發 React onChange
    const scrubber = page.getByTestId('chips-trend-scrubber');
    await scrubber.evaluate((el: HTMLInputElement) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(el, '10');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // scrubber 右側日期文字反映 index=10 → 2026/07/11
    await expect(page.getByTestId('chips-trend-chart')).toContainText('2026/07/11');


    await page.evaluate(() => (document as any).fonts?.ready);

    await expect(page.getByTestId('chips-trend-chart')).toHaveScreenshot(
      'chips-trend-playback-mid.png',
      { mask: [page.getByTestId('chips-trend-scrubber')] },
    );
  });

  test('5. badge OFFLINE — 離線 banner + OFFLINE 徽章', async ({ page }) => {
    // 攔截保底：即使 hook 誤發送 request 也擋掉
    await page.route(CHIPS_ROUTE, (r) => r.abort('failed'));
    await page.goto(`/e2e/chips-section?code=${STOCK}&force=offline&freezeTime=1`);
    const section = page.getByTestId('chips-section');
    await section.waitFor();
    await expect(page.getByTestId('chips-offline-badge')).toBeVisible();
    await expect(page.getByTestId('chips-error-banner')).toBeVisible();
    await page.evaluate(() => (document as any).fonts?.ready);

    await expect(section).toHaveScreenshot('chips-badge-offline.png', {
      mask: dynamicMasks(page),
    });
  });

  test('6. badge STALE — 快取 > TTL 徽章', async ({ page }) => {
    await page.route(CHIPS_ROUTE, (r) => fulfill(r, fullPayload()));
    await page.goto(`/e2e/chips-section?code=${STOCK}&force=stale&freezeTime=1`);
    const section = page.getByTestId('chips-section');
    await section.waitFor();
    // harness 在 800ms 後把 Date.now 前推 6 分鐘 → STALE 亮起
    await expect(page.getByTestId('chips-stale-badge')).toBeVisible({ timeout: 5_000 });
    await page.evaluate(() => (document as any).fonts?.ready);

    await expect(section).toHaveScreenshot('chips-badge-stale.png', {
      mask: dynamicMasks(page),
    });
  });

  test('7. error 500 — 紅框 banner + 重試按鈕', async ({ page }) => {
    await page.route(CHIPS_ROUTE, (r) => fulfill(r, 'boom', 500));
    await page.goto(`/e2e/chips-section?code=${STOCK}&freezeTime=1`);
    const banner = page.getByTestId('chips-error-banner');
    await banner.waitFor();
    await page.evaluate(() => (document as any).fonts?.ready);

    await expect(banner).toHaveScreenshot('chips-error-500.png');
  });

  test('8. empty state — inst / bsr missing 文案 + 排程時間', async ({ page }) => {
    await page.route(CHIPS_ROUTE, (r) => fulfill(r, emptyPayload()));
    await page.goto(`/e2e/chips-section?code=${STOCK}&freezeTime=1`);
    const section = page.getByTestId('chips-section');
    await section.waitFor();
    await expect(page.getByTestId('chips-inst-missing')).toBeVisible();
    await expect(page.getByTestId('chips-bsr-missing')).toBeVisible();
    await page.evaluate(() => (document as any).fonts?.ready);

    await expect(section).toHaveScreenshot('chips-empty-state.png', {
      mask: dynamicMasks(page),
    });
  });
});
