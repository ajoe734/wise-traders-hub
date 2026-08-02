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
 *   9. force=fresh 權重     — fresh > stale（行為斷言）
 *  10. STALE 矩陣          — visibility(hidden/visible) × refresh delay
 *  11. FRESH 矩陣          — visibility(hidden/visible) × refresh delay，
 *                            並斷言 FRESH 與 STALE 互斥（永不被 stale 規則誤傷）

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

  /**
   * STALE 是唯一有「時間推移」的斷點，過去最容易間歇性失敗。三道保險：
   *   1. 固定時鐘注入：now=FROZEN_FETCHED_AT → 「更新於 N 分鐘前」完全決定論，
   *      不再依賴機器時間，也不需要 mask 相對時間文字。
   *   2. 決定論等待：等 harness 的 data-stale-shifted="1" 訊號，不睡秒數。
   *   3. 快照鎖定：先斷言 badge 文案與相對時間文案，再截圖；截圖關動畫、
   *      maxDiffPixelRatio=0（像素級鎖定），並允許本測試重試 2 次。
   */
  test.describe('6. badge STALE', () => {
    test.describe.configure({ retries: 2 });

    test('固定時鐘 → STALE 徽章穩定顯示', async ({ page }) => {
      await page.route(CHIPS_ROUTE, (r) => fulfill(r, fullPayload()));
      const nowMs = Date.parse(FROZEN_FETCHED_AT);
      await page.goto(
        `/e2e/chips-section?code=${STOCK}&force=stale&freezeTime=1` +
          `&now=${nowMs}&staleAfter=300&staleShift=${6 * 60 * 1000}`,
      );
      const section = page.getByTestId('chips-section');
      await section.waitFor();

      // (2) 等時鐘位移實際套用（而非睡固定秒數）
      await expect(page.getByTestId('chips-harness-root')).toHaveAttribute(
        'data-stale-shifted',
        '1',
        { timeout: 10_000 },
      );

      // (3) 快照鎖定：badge 亮起且相對時間為決定論的「6 分鐘前」
      const badge = page.getByTestId('chips-stale-badge');
      await expect(badge).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('text=/^更新於/')).toContainText('6 分鐘前');
      // badge 不得自己熄滅（自動重抓已被 hidden tab 擋掉）
      await page.waitForTimeout(500);
      await expect(badge).toBeVisible();

      await page.evaluate(() => (document as any).fonts?.ready);

      await expect(section).toHaveScreenshot('chips-badge-stale.png', {
        // 固定時鐘後相對時間不再漂移 → 只 mask native scrubber thumb
        mask: [page.getByTestId('chips-trend-scrubber')],
        animations: 'disabled',
        maxDiffPixelRatio: 0,
      });
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


  /**
   * 9. force=fresh 的權重驗證（非快照，純行為）：
   * fresh > stale — 兩者同時給時時鐘不得位移，STALE badge 永遠不出現。
   * 規格見 docs/qa/harness-clock-injection.md。
   */
  test('9. force=fresh 權重高於 stale — 徽章不得亮起', async ({ page }) => {
    await page.route(CHIPS_ROUTE, (r) => fulfill(r, fullPayload()));
    const nowMs = Date.parse(FROZEN_FETCHED_AT);
    await page.goto(
      `/e2e/chips-section?code=${STOCK}&force=stale,fresh&now=${nowMs}&staleAfter=200`,
    );
    await page.getByTestId('chips-section').waitFor();
    const root = page.getByTestId('chips-harness-root');
    await expect(root).toHaveAttribute('data-fixed-now', '1');
    await page.waitForTimeout(1_500); // 遠超過 staleAfter 與壓縮後的 ticker
    await expect(root).toHaveAttribute('data-stale-shifted', '0');
    await expect(page.getByTestId('chips-stale-badge')).toHaveCount(0);
    await expect(page.locator('text=/^更新於/')).toContainText('剛剛更新');
  });

  /**
   * 10. STALE 視覺回歸矩陣 · visibilityState × auto revalidate delay
   *
   * 背景：`fetchedAt = query.dataUpdatedAt`（真實時鐘），而自動重抓由
   * planAutoRefresh 決定（!visible → 'paused'）。所以 STALE badge 的壽命
   * 完全取決於「分頁可見性」與「重抓回應延遲」兩個變數。過去只覆蓋
   * hidden 一種組合，任何讓 hidden 失效的改動都會讓快照被 auto revalidate
   * 吃掉、變成間歇性紅燈。本矩陣把三種組合全部釘死：
   *
   *   A. hidden        + 快回應 → 完全不排程，badge 永久亮（快照基準）
   *   B. visible       + 慢回應 → 重抓進行中 badge 仍亮（快照 refreshing 態）
   *   C. visible       + 快回應 → 重抓完成後 badge 熄滅、改顯示「剛剛更新」
   *   D. hidden→visible 切換    → 切換前恆亮，切換後才被 revalidate 收掉
   *
   * 三道保險同 #6：固定時鐘（now=）、等 data-stale-shifted、maxDiffPixelRatio=0。
   */
  test.describe('10. badge STALE 矩陣 · visibility × refresh delay', () => {
    test.describe.configure({ retries: 2 });

    const NOW_MS = Date.parse(FROZEN_FETCHED_AT);
    const SHIFT_MS = 6 * 60 * 1000;

    /** 首發立即回、後續（auto revalidate）延遲 delayMs 才回 */
    async function routeWithRefreshDelay(
      page: import('@playwright/test').Page,
      delayMs: number,
    ) {
      const calls = { n: 0 };
      await page.route(CHIPS_ROUTE, async (r) => {
        calls.n += 1;
        if (calls.n > 1 && delayMs > 0) {
          await new Promise((res) => setTimeout(res, delayMs));
        }
        await fulfill(r, fullPayload());
      });
      return calls;
    }

    function harnessUrl(visibility: 'hidden' | 'visible') {
      return (
        `/e2e/chips-section?code=${STOCK}&force=stale&freezeTime=1&now=${NOW_MS}` +
        `&staleAfter=300&staleShift=${SHIFT_MS}&visibility=${visibility}`
      );
    }

    async function gotoShifted(
      page: import('@playwright/test').Page,
      visibility: 'hidden' | 'visible',
    ) {
      await page.goto(harnessUrl(visibility));
      const section = page.getByTestId('chips-section');
      await section.waitFor();
      const root = page.getByTestId('chips-harness-root');
      await expect(root).toHaveAttribute('data-visibility', visibility);
      await expect(root).toHaveAttribute('data-stale-shifted', '1', { timeout: 10_000 });
      return section;
    }

    test('A. hidden + 快回應 — 不排程重抓，badge 永久亮', async ({ page }) => {
      const calls = await routeWithRefreshDelay(page, 0);
      const section = await gotoShifted(page, 'hidden');

      const badge = page.getByTestId('chips-stale-badge');
      await expect(badge).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(1_200);
      await expect(badge).toBeVisible();
      await expect(page.locator('text=/^更新於/')).toContainText('6 分鐘前');
      expect(calls.n).toBe(1); // paused → 一次都沒有自動重抓

      await page.evaluate(() => (document as any).fonts?.ready);
      await expect(section).toHaveScreenshot('chips-badge-stale-hidden.png', {
        mask: [page.getByTestId('chips-trend-scrubber')],
        animations: 'disabled',
        maxDiffPixelRatio: 0,
      });
    });

    test('B. visible + 慢回應 — 重抓中 badge 仍亮（不被吃掉）', async ({ page }) => {
      await routeWithRefreshDelay(page, 3_000);
      const section = await gotoShifted(page, 'visible');

      const badge = page.getByTestId('chips-stale-badge');
      await expect(badge).toBeVisible({ timeout: 10_000 });
      // 自動重抓已在飛行中，但 fetchedAt 還沒更新 → badge 不得熄滅
      await page.waitForTimeout(1_200);
      await expect(badge).toBeVisible();
      await expect(page.locator('text=/^更新於/')).toContainText('6 分鐘前');

      await page.evaluate(() => (document as any).fonts?.ready);
      await expect(section).toHaveScreenshot('chips-badge-stale-refreshing.png', {
        mask: [page.getByTestId('chips-trend-scrubber')],
        animations: 'disabled',
        maxDiffPixelRatio: 0,
      });
    });

    test('C. visible + 快回應 — 重抓完成後才熄滅並回到「剛剛更新」', async ({ page }) => {
      const calls = await routeWithRefreshDelay(page, 0);
      await gotoShifted(page, 'visible');

      const badge = page.getByTestId('chips-stale-badge');
      // 熄滅是「重抓完成」的結果，不是 badge 自己不穩
      await expect(badge).toHaveCount(0, { timeout: 10_000 });
      await expect(page.locator('text=/^更新於/')).toContainText('剛剛更新');
      expect(calls.n).toBeGreaterThan(1);
    });

    test('D. hidden → visible 切換 — 切換前恆亮，切換後才被收掉', async ({ page }) => {
      const calls = await routeWithRefreshDelay(page, 0);
      await gotoShifted(page, 'hidden');

      const badge = page.getByTestId('chips-stale-badge');
      await expect(badge).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(800);
      await expect(badge).toBeVisible();
      expect(calls.n).toBe(1);

      await page.evaluate(() => (window as any).__harnessSetVisibility('visible'));
      await expect(page.getByTestId('chips-harness-root')).toBeVisible();
      await expect(badge).toHaveCount(0, { timeout: 10_000 });
      expect(calls.n).toBeGreaterThan(1);
    });
  });

  /**
   * 11. FRESH 視覺回歸矩陣 · visibilityState × auto revalidate delay
   *
   * FRESH 與 STALE 互斥（`!stale` vs `stale`），但兩者共用同一條新鮮度管線
   * （useFreshness ticker + planAutoRefresh）。過去只釘死 STALE，任何 TTL /
   * ticker / 可見性改動都可能讓 FRESH 被 stale 規則誤傷（例如 ticker 誤把
   * 未過期資料判成過期、或背景分頁下 age 停止推進而 badge 抖動）。
   *
   * 本矩陣把 FRESH 在四種組合下釘死，且每一則都同時斷言
   * `chips-stale-badge` 為 0 —— FRESH 亮著時 STALE 永遠不得出現：
   *
   *   A. hidden  + 快回應  → 不排程重抓，FRESH 恆亮（快照基準）
   *   B. visible + 慢回應  → 重抓進行中不得閃成 STALE（快照 refreshing 態）
   *   C. visible + 快回應  → 重抓完成仍是 FRESH，請求數 > 0 但 badge 不變
   *   D. hidden→visible 切換 → 切換前後皆 FRESH，不因可見性變化被誤判
   *
   * 決定論手段同 #10：固定時鐘 `now=`（force=fresh 讓時鐘釘死且永不位移）、
   * `data-fixed-now` 訊號、animations disabled + maxDiffPixelRatio=0。
   */
  test.describe('11. badge FRESH 矩陣 · visibility × refresh delay', () => {
    test.describe.configure({ retries: 2 });

    const NOW_MS = Date.parse(FROZEN_FETCHED_AT);

    /** 首發立即回、後續（auto revalidate）延遲 delayMs 才回 */
    async function routeWithRefreshDelay(
      page: import('@playwright/test').Page,
      delayMs: number,
    ) {
      const calls = { n: 0 };
      await page.route(CHIPS_ROUTE, async (r) => {
        calls.n += 1;
        if (calls.n > 1 && delayMs > 0) {
          await new Promise((res) => setTimeout(res, delayMs));
        }
        await fulfill(r, fullPayload());
      });
      return calls;
    }

    async function gotoFresh(
      page: import('@playwright/test').Page,
      visibility: 'hidden' | 'visible',
    ) {
      // force=fresh：時鐘釘死在 now，且權重高於 stale → 永不位移
      await page.goto(
        `/e2e/chips-section?code=${STOCK}&force=fresh&now=${NOW_MS}` +
          `&staleAfter=200&visibility=${visibility}`,
      );
      const section = page.getByTestId('chips-section');
      await section.waitFor();
      const root = page.getByTestId('chips-harness-root');
      await expect(root).toHaveAttribute('data-visibility', visibility);
      await expect(root).toHaveAttribute('data-fixed-now', '1');
      return section;
    }

    /** FRESH 亮、STALE 熄、位移未發生、文案為「剛剛更新」 */
    async function expectFreshOnly(page: import('@playwright/test').Page) {
      await expect(page.getByTestId('chips-fresh-badge')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('chips-stale-badge')).toHaveCount(0);
      await expect(page.getByTestId('chips-harness-root')).toHaveAttribute(
        'data-stale-shifted',
        '0',
      );
      await expect(page.locator('text=/^更新於/')).toContainText('剛剛更新');
    }

    test('A. hidden + 快回應 — 不排程重抓，FRESH 恆亮', async ({ page }) => {
      const calls = await routeWithRefreshDelay(page, 0);
      const section = await gotoFresh(page, 'hidden');

      await expectFreshOnly(page);
      await page.waitForTimeout(1_500); // 遠超過壓縮前的 ticker 與 staleAfter
      await expectFreshOnly(page);
      expect(calls.n).toBe(1); // 未過期 → 本來就不該有自動重抓

      await page.evaluate(() => (document as any).fonts?.ready);
      await expect(section).toHaveScreenshot('chips-badge-fresh-hidden.png', {
        mask: [page.getByTestId('chips-trend-scrubber')],
        animations: 'disabled',
        maxDiffPixelRatio: 0,
      });
    });

    test('B. visible + 慢回應 — 重抓延遲不得讓 FRESH 掉成 STALE', async ({ page }) => {
      await routeWithRefreshDelay(page, 3_000);
      const section = await gotoFresh(page, 'visible');

      await expectFreshOnly(page);
      await page.waitForTimeout(1_500);
      await expectFreshOnly(page);

      await page.evaluate(() => (document as any).fonts?.ready);
      await expect(section).toHaveScreenshot('chips-badge-fresh-visible.png', {
        mask: [page.getByTestId('chips-trend-scrubber')],
        animations: 'disabled',
        maxDiffPixelRatio: 0,
      });
    });

    test('C. visible + 快回應 — 重抓完成後仍是 FRESH', async ({ page }) => {
      await routeWithRefreshDelay(page, 0);
      await gotoFresh(page, 'visible');

      await expectFreshOnly(page);
      await page.waitForTimeout(1_200);
      await expectFreshOnly(page);
      // 未過期時 auto revalidate 不該被排程（stamp 探針另計）
      await expect(page.getByTestId('chips-auto-refresh-badge')).toHaveCount(0);
    });

    test('D. hidden → visible 切換 — 可見性變化不得誤判成 STALE', async ({ page }) => {
      await routeWithRefreshDelay(page, 0);
      await gotoFresh(page, 'hidden');
      await expectFreshOnly(page);

      await page.evaluate(() => (window as any).__harnessSetVisibility('visible'));
      await page.waitForTimeout(1_200);
      await expectFreshOnly(page);

      await page.evaluate(() => (window as any).__harnessSetVisibility('hidden'));
      await page.waitForTimeout(600);
      await expectFreshOnly(page);
    });
  });
});



