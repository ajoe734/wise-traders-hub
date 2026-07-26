/**
 * E2E · ChipsSection 抽屜籌碼面全覆蓋
 *
 * 覆蓋範圍：
 *   1. 非台股代碼 → 完全不渲染
 *   2. 完整資料 → header / 三大法人 / BSR / 集中度警告 / 趨勢圖 讀值全對
 *   3. 空資料 payload → inst-missing / bsr-missing / 趨勢圖 placeholder，
 *      且明確帶排程時間提示（17:45 / 18:15）
 *   4. 部分欄位缺失 → institutional 有值但 series 缺失時 trend chart placeholder
 *   5. BSR 只有 d20 → bsrLatest fallback 到 d20 正常渲染
 *   6. HTTP 500 → error banner「伺服器暫時無法回應」+ status 500 + 重試按鈕可點
 *   7. HTTP 404 → error banner「此代號無籌碼資料」
 *   8. 逾時 abort → error banner「請求逾時」
 *   9. 離線 → OFFLINE badge + banner，重試按鈕 disabled
 *  10. 重試流程 → 500 之後 refetch 拿到成功 payload，banner 消失、資料出現
 *  11. DOM / 文字一致性：所有 testid 與關鍵標籤都存在，數字色（紅+/綠-）符合台灣慣例
 */
import { test, expect, Route } from '@playwright/test';

const STOCK = '2330';
const CHIPS_ROUTE = '**/tw-chips-detail**';

function fullPayload(overrides: Record<string, any> = {}) {
  const dates = Array.from({ length: 20 }, (_, i) => {
    const d = new Date(2026, 6, 1 + i);
    return d.toISOString().slice(0, 10);
  });
  const inst_daily = dates.map((date, i) => ({
    date,
    foreign_net: (i % 3 === 0 ? 1 : -1) * (100_000 + i * 5_000),
    trust_net: (i % 2 === 0 ? 1 : -1) * (30_000 + i * 1_000),
    dealer_net: 5_000 * (i - 10),
    total_net: (i % 3 === 0 ? 1 : -1) * (140_000 + i * 4_000),
  }));
  const bsr_conc = dates.map((date, i) => ({
    date,
    concentration_ratio: 45 + i * 2, // 一路爬升過 70
    top_net: 200_000 + i * 1_000,
  }));
  return {
    stock_id: STOCK,
    as_of: '2026-07-20',
    institutional: {
      d1: { foreign_net: 250_000, trust_net: 40_000, dealer_net: -5_000, total_net: 285_000, days_covered: 1 },
      d5: { foreign_net: 1_200_000, trust_net: 180_000, dealer_net: -20_000, total_net: 1_360_000, days_covered: 5 },
      d20: { foreign_net: 3_500_000, trust_net: 400_000, dealer_net: -80_000, total_net: 3_820_000, days_covered: 20 },
      d60: { foreign_net: -1_800_000, trust_net: 600_000, dealer_net: 100_000, total_net: -1_100_000, days_covered: 60 },
    },
    bsr: {
      d5: {
        top_buy: [
          { broker_id: '9800', name: '元大-台北', net: 1_500_000 },
          { broker_id: '9200', name: '凱基-敦南', net: 900_000 },
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
      institutional_daily: inst_daily,
      bsr_concentration: bsr_conc,
    },
    source: 'TWSE',
    fetched_at: new Date().toISOString(),
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
    fetched_at: new Date().toISOString(),
  };
}

async function mockChips(page, handler: (route: Route) => Promise<void> | void) {
  await page.route(CHIPS_ROUTE, handler);
}

async function fulfill(route: Route, body: any, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

test.describe('ChipsSection · 全覆蓋', () => {
  test('1. 非台股代碼完全不渲染', async ({ page }) => {
    await mockChips(page, (r) => fulfill(r, fullPayload()));
    await page.goto('/e2e/chips-section?code=AAPL');
    await page.getByTestId('chips-harness-code').waitFor();
    await expect(page.getByTestId('chips-section')).toHaveCount(0);
  });

  test('2. 完整資料 → header / 法人 / BSR / 集中度警告 / 趨勢讀值', async ({ page }) => {
    await mockChips(page, (r) => fulfill(r, fullPayload()));
    await page.goto(`/e2e/chips-section?code=${STOCK}`);

    const section = page.getByTestId('chips-section');
    await section.waitFor();
    await expect(section).toContainText('籌碼面');
    await expect(section).toContainText('AS OF 2026/07/20');
    await expect(section).toContainText(/更新於\s+\S+/);
    await expect(page.getByTestId('chips-error-banner')).toHaveCount(0);
    await expect(page.getByTestId('chips-offline-badge')).toHaveCount(0);

    // 三大法人：3 列 x 4 視窗 = 12 testid
    for (const k of ['foreign_net', 'trust_net', 'dealer_net']) {
      for (const w of ['d1', 'd5', 'd20', 'd60']) {
        await expect(page.getByTestId(`chips-inst-${k}-${w}`)).toBeVisible();
      }
    }
    // 值格式：正號 + 千分位 + 沒有 "股"
    const d1For = await page.getByTestId('chips-inst-foreign_net-d1').innerText();
    expect(d1For).toMatch(/^\+\d/);
    // 台灣慣例紅色 (#C43D3D) 正值
    const color = await page
      .getByTestId('chips-inst-foreign_net-d1')
      .evaluate((el) => getComputedStyle(el).color);
    expect(color).toMatch(/196,\s*61,\s*61/);

    // BSR
    const bsr = page.getByTestId('chips-bsr');
    await expect(bsr).toBeVisible();
    await expect(bsr).toContainText('元大-台北');
    await expect(bsr).toContainText('新光-城中');
    await expect(bsr).toContainText('集中度：買超前 15 大占 78%');
    await expect(bsr).toContainText('高（籌碼集中，跟隨風險升高）');

    // 趨勢圖
    await expect(page.getByTestId('chips-trend-chart')).toBeVisible();
    await expect(page.getByTestId('chips-trend-scrubber')).toBeVisible();
    await expect(page.getByTestId('chips-trend-play')).toBeVisible();
    await expect(page.getByTestId('chips-trend-readout')).toContainText('5 日滾動淨買賣');
    // 切到集中度模式
    await page.getByRole('button', { name: '分點集中度' }).click();
    await expect(page.getByTestId('chips-trend-readout')).toContainText('Top15 買超集中度');
    await expect(page.getByTestId('chips-trend-readout')).toContainText(/%$/);
  });

  test('3. 空 payload → 三大法人 / BSR 缺失文案 + 排程時間提示 + 趨勢圖 placeholder', async ({ page }) => {
    await mockChips(page, (r) => fulfill(r, emptyPayload()));
    await page.goto(`/e2e/chips-section?code=${STOCK}`);
    await page.getByTestId('chips-section').waitFor();

    await expect(page.getByTestId('chips-inst-missing')).toBeVisible();
    await expect(page.getByTestId('chips-inst-missing')).toContainText('三大法人資料尚未同步');
    await expect(page.getByTestId('chips-inst-missing')).toContainText('17:45');

    await expect(page.getByTestId('chips-bsr-missing')).toBeVisible();
    await expect(page.getByTestId('chips-bsr-missing')).toContainText('分點資料尚未同步');
    await expect(page.getByTestId('chips-bsr-missing')).toContainText('18:15');

    await expect(page.getByTestId('chips-trend-chart')).toHaveCount(0);
    await expect(page.getByText('尚無歷史序列資料')).toBeVisible();

    // 沒有法人資料也不該顯示 error banner（成功回應只是空）
    await expect(page.getByTestId('chips-error-banner')).toHaveCount(0);
  });

  test('4. 部分欄位：inst 有值但 series 缺失 → trend placeholder + 法人正常渲染', async ({ page }) => {
    await mockChips(page, (r) =>
      fulfill(r, fullPayload({ series: undefined, bsr: { d5: null, d20: null, d60: null }, bsr_as_of: null })),
    );
    await page.goto(`/e2e/chips-section?code=${STOCK}`);
    await page.getByTestId('chips-section').waitFor();

    await expect(page.getByTestId('chips-institutional')).toBeVisible();
    await expect(page.getByTestId('chips-bsr-missing')).toBeVisible();
    await expect(page.getByText('BSR 未同步')).toBeVisible();
    await expect(page.getByText('尚無歷史序列資料')).toBeVisible();
  });

  test('5. BSR 只有 d20 → bsrLatest fallback', async ({ page }) => {
    const payload = fullPayload();
    payload.bsr = {
      d5: null,
      d20: payload.bsr.d5, // 把 d5 資料移到 d20
      d60: null,
    };
    await mockChips(page, (r) => fulfill(r, payload));
    await page.goto(`/e2e/chips-section?code=${STOCK}`);
    await expect(page.getByTestId('chips-bsr')).toContainText('元大-台北');
  });

  test('6. HTTP 500 → error banner 顯示原因、狀態碼與重試按鈕', async ({ page }) => {
    await mockChips(page, (r) => fulfill(r, 'boom', 500));
    await page.goto(`/e2e/chips-section?code=${STOCK}`);
    const banner = page.getByTestId('chips-error-banner');
    await banner.waitFor();
    await expect(banner).toContainText('伺服器錯誤');
    await expect(banner).toContainText('500');
    await expect(banner).toContainText('伺服器暫時無法回應');
    await expect(page.getByTestId('chips-retry')).toBeEnabled();
  });

  test('7. HTTP 404 → not_found 文案', async ({ page }) => {
    await mockChips(page, (r) => fulfill(r, { error: 'not found' }, 404));
    await page.goto(`/e2e/chips-section?code=${STOCK}`);
    const banner = page.getByTestId('chips-error-banner');
    await banner.waitFor();
    await expect(banner).toContainText('無資料');
    await expect(banner).toContainText('此代號無籌碼資料');
  });

  test('8. 逾時 abort → timeout 文案', async ({ page }) => {
    await mockChips(page, (route) => route.abort('timedout'));
    await page.goto(`/e2e/chips-section?code=${STOCK}`);
    const banner = page.getByTestId('chips-error-banner');
    await banner.waitFor();
    // classifyError 會走 network / timeout 分支；訊息含「網路異常」或「請求逾時」都算合格
    await expect(banner).toContainText(/請求逾時|網路異常/);
  });

  test('9. 離線：注入 offline → OFFLINE badge + banner，重試按鈕 disabled', async ({ page, context }) => {
    // 在頁面載入前就把 navigator.onLine 覆寫為 false
    // hook 會在偵測到 offline 時直接短路，不會真的發 request
    await context.addInitScript(() => {
      Object.defineProperty(window.navigator, 'onLine', {
        value: false,
        configurable: true,
      });
    });
    // 保底：即使有任何請求跑出去，也直接 fail 掉
    await page.route(CHIPS_ROUTE, (route) => route.abort('failed'));

    await page.goto(`/e2e/chips-section?code=${STOCK}`);
    await page.getByTestId('chips-section').waitFor();

    await expect(page.getByTestId('chips-offline-badge')).toBeVisible();
    const banner = page.getByTestId('chips-error-banner');
    await banner.waitFor();
    await expect(banner).toContainText('離線');
    await expect(page.getByTestId('chips-retry')).toBeDisabled();
  });

  test('10. 重試流程：500 → 重試 → 成功', async ({ page }) => {
    let calls = 0;
    await mockChips(page, (route) => {
      calls += 1;
      if (calls === 1) return fulfill(route, 'boom', 500);
      return fulfill(route, fullPayload());
    });
    await page.goto(`/e2e/chips-section?code=${STOCK}`);
    await page.getByTestId('chips-error-banner').waitFor();
    await page.getByTestId('chips-retry').click();

    await expect(page.getByTestId('chips-error-banner')).toHaveCount(0);
    await expect(page.getByTestId('chips-institutional')).toBeVisible();
    await expect(page.getByTestId('chips-bsr')).toBeVisible();
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  test('11. DOM / 文字一致性：關鍵標籤與 testid 齊備', async ({ page }) => {
    await mockChips(page, (r) => fulfill(r, fullPayload()));
    await page.goto(`/e2e/chips-section?code=${STOCK}`);
    await page.getByTestId('chips-section').waitFor();

    for (const t of [
      'chips-section',
      'chips-institutional',
      'chips-bsr',
      'chips-trend-chart',
      'chips-trend-scrubber',
      'chips-trend-play',
      'chips-trend-readout',
    ]) {
      await expect(page.getByTestId(t)).toBeVisible();
    }
    const section = page.getByTestId('chips-section');
    for (const label of [
      '籌碼面',
      '外資',
      '投信',
      '自營商',
      '關鍵分點（近 5 日）',
      '買超前 3',
      '賣超前 3',
      '趨勢與歷史回放',
      '三大法人',
      '分點集中度',
    ]) {
      await expect(section).toContainText(label);
    }
    // 資料來源文案：現以 TWSE + TPEx 為官方資料來源
    await expect(page.getByTestId('chips-data-source')).toHaveText(
      /資料來源[:：].*TWSE.*TPEx/,
    );
    // 負值 (d60 total 是負) → 綠色
    const negColor = await page
      .getByTestId('chips-inst-foreign_net-d60')
      .evaluate((el) => getComputedStyle(el).color);
    expect(negColor).toMatch(/46,\s*122,\s*75/);
  });

  test('N. 開抽屜不得觸發 ensure_bsr_queued（BSR 對前端唯讀）', async ({ page }) => {
    const enqueueCalls: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      if (/\/rpc\/ensure_bsr_queued/.test(url)) enqueueCalls.push(url);
    });
    await mockChips(page, (r) => fulfill(r, fullPayload()));
    await page.goto(`/e2e/chips-section?code=${STOCK}`);
    await page.getByTestId('chips-section').waitFor();
    // 給 useEffect / SWR 一點時間去做副作用
    await page.waitForTimeout(1500);
    expect(enqueueCalls, `不應該有 ensure_bsr_queued 請求: ${enqueueCalls.join(',')}`).toEqual([]);
  });

  test('O. 資料稀疏時：摘要與趨勢圖都顯示相同的覆蓋比例，不自動重複補齊', async ({ page }) => {
    const dates = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(2026, 6, 1 + i);
      return d.toISOString().slice(0, 10);
    });
    const inst_daily = dates.map((date, i) => ({
      date,
      foreign_net: -10_000 - i * 1_000,
      trust_net: 5_000 + i * 500,
      dealer_net: 1_000,
      total_net: -4_000,
    }));
    const payload = fullPayload({
      institutional: {
        d1: null, d5: null, d20: null,
        d60: { foreign_net: -9388, trust_net: 1200, dealer_net: 500, total_net: -7688, days_covered: 6 },
      },
      bsr: { d5: null, d20: null, d60: null },
      bsr_as_of: null,
      series: {
        institutional_daily: inst_daily,
        bsr_concentration: [],
      },
      readiness: {
        institutional: {
          '5': { state: 'filling', have: 3, need: 5 },
          '20': { state: 'filling', have: 6, need: 20 },
          '60': { state: 'filling', have: 6, need: 60 },
        },
        bsr_concentration: {},
      },
    });
    let backfillCount = 0;
    await page.route('**/tw-institutional-daily-sync', (route) => {
      backfillCount += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
    });
    await page.route('**/enqueue_bsr_backfill', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }));
    await mockChips(page, (r) => fulfill(r, payload));
    await page.goto(`/e2e/chips-section?code=${STOCK}`);
    await page.getByTestId('chips-section').waitFor();

    // 摘要顯示 partial 值與覆蓋標記
    const cell = page.getByTestId('chips-inst-foreign_net-d60');
    await expect(cell).toContainText('-9,388');
    await expect(cell).toContainText('(6/60)');
    await expect(cell).toHaveAttribute('data-readiness-state', 'filling');

    // 趨勢圖 caption 與摘要格子的覆蓋比例一致
    const caption = page.getByTestId('chips-trend-readiness-caption');
    await expect(caption).toContainText('6');
    await expect(caption).toContainText('60');
    await expect(page.getByTestId('chips-trend-chart')).toHaveAttribute('data-readiness-state', 'filling');
    await expect(page.getByTestId('chips-trend-chart')).toHaveAttribute('data-readiness-have', '6');
    await expect(page.getByTestId('chips-trend-chart')).toHaveAttribute('data-readiness-need', '60');

    // 等待一下，自動回補只應該觸發一次
    await page.waitForTimeout(1500);
    expect(backfillCount).toBeLessThanOrEqual(1);
  });
});
