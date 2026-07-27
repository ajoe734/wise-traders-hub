/**
 * Phase G · Chips 抽屜互動 E2E — 端到端事件契約
 *
 * 目的：Phase F 的 ChipsCacheTelemetryCard（含端到端漏斗）完全依賴
 * useTwChipsDetail 送出的 traffic_events。這支 spec 鎖死該契約：
 *
 *   drawer_open 流程 → 送出 chips_memory_miss + chips_fetch_start +
 *   chips_fetch_done，且 fetch_done 一定要帶 edge_cache 與 bsr_source
 *   props（Phase F 漏斗以此拆 L2 / L3）。
 *
 * 額外覆蓋：
 *   - edge_cache='hit'       → 漏斗 L2 命中
 *   - edge_cache='coalesced' → 漏斗 coalesced
 *   - edge_cache='miss'+bsr_source='raw_fallback' → 漏斗 DB fallback（Phase E）
 *
 * 網路完全 mock，不打真實 DB／edge function。
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { gotoWithRetry } from './helpers/navigation';

type IngestEvent = { event_name: string; event_props: Record<string, unknown> | null };

/** 建立 chips detail 假 payload（可覆寫 _cache_meta / bsr_source） */
function fakeChipsPayload(overrides: Record<string, unknown> = {}) {
  return {
    stock_id: '2330',
    as_of: '2026-07-24',
    as_of_lag_days: 0,
    institutional: {
      d1: null,
      d5: { foreign_net: 1000, trust_net: 500, dealer_net: 0, total_net: 1500, days_covered: 5 },
      d20: null,
      d60: null,
    },
    bsr: { d5: null, d20: null, d60: null },
    bsr_as_of: '2026-07-24',
    bsr_as_of_lag_days: 0,
    bsr_source: 'rollup',
    bsr_source_date: '2026-07-24',
    bsr_fallback_used: false,
    bsr_expected_date: '2026-07-24',
    bsr_lag_weekdays: 0,
    bsr_freshness_status: 'fresh',
    bsr_sync_status: {
      eligible: true, ineligible_reason: null, asset_class: 'stock',
      queued: false, status: 'not_queued', next_run_at: null,
      attempts: 0, max_attempts: 3, error_code: null, retryable: false,
    },
    source: 'TWSE',
    cached: false,
    _cache_meta: { cache: 'miss', stamp_ver: 'v1', served_at: new Date().toISOString() },
    ...overrides,
  };
}

/**
 * 監聽 /functions/v1/traffic-ingest，回傳收集 chips_* 事件的陣列
 * （逐次 push；beacon 與 fetch 都被 Playwright 攔截為 request 事件）
 */
function captureChipsEvents(page: Page): IngestEvent[] {
  const events: IngestEvent[] = [];
  page.on('request', (req) => {
    if (!/\/functions\/v1\/traffic-ingest/.test(req.url())) return;
    if (req.method() !== 'POST') return;
    try {
      const raw = req.postData();
      if (!raw) return;
      const body = JSON.parse(raw);
      const name = String(body?.event_name ?? '');
      if (!name.startsWith('chips_')) return;
      events.push({ event_name: name, event_props: body?.event_props ?? null });
    } catch {
      /* ignore malformed */
    }
  });
  return events;
}

/** 統一 mock：tw-chips-detail 回指定 payload；traffic-ingest 一律 200 */
async function mockChipsWith(page: Page, payload: unknown) {
  await page.route(/\/functions\/v1\/tw-chips-detail(\?|$)/, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });
  await page.route(/\/functions\/v1\/traffic-ingest(\?|$)/, async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
}

async function waitForEvent(
  events: IngestEvent[],
  name: string,
  timeoutMs = 5000,
): Promise<IngestEvent> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const hit = events.find((e) => e.event_name === name);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timeout waiting for event ${name}; got: ${events.map((e) => e.event_name).join(',')}`);
}

test.describe('Phase G · Chips 端到端事件契約', () => {
  test('drawer_open + edge_cache=miss + bsr_source=rollup → L3 rollup 事件鏈完整', async ({ page }) => {
    await mockChipsWith(page, fakeChipsPayload());
    const events = captureChipsEvents(page);

    await gotoWithRetry(page, '/e2e/chips-section?code=2330', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('chips-section').first().waitFor({ timeout: 15_000 });

    const miss = await waitForEvent(events, 'chips_memory_miss');
    expect(miss.event_props?.source).toBe('drawer_open');
    expect(miss.event_props?.reason).toBe('no_entry'); // 第一次載入沒有 cache entry

    const start = await waitForEvent(events, 'chips_fetch_start');
    expect(start.event_props?.source).toBe('drawer_open');

    const done = await waitForEvent(events, 'chips_fetch_done');
    // Phase F 漏斗需要這兩個 props
    expect(done.event_props?.edge_cache).toBe('miss');
    expect(done.event_props?.bsr_source).toBe('rollup');
    expect(done.event_props?.source).toBe('drawer_open');
    expect(typeof done.event_props?.duration_ms).toBe('number');
  });

  test('edge_cache=hit → L2 edge 命中事件送達（Phase F 漏斗 L2）', async ({ page }) => {
    const payload = fakeChipsPayload({
      _cache_meta: { cache: 'hit', stamp_ver: 'v1', served_at: new Date().toISOString() },
    });
    await mockChipsWith(page, payload);
    const events = captureChipsEvents(page);

    await gotoWithRetry(page, '/e2e/chips-section?code=2330', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('chips-section').first().waitFor({ timeout: 15_000 });

    const done = await waitForEvent(events, 'chips_fetch_done');
    expect(done.event_props?.edge_cache).toBe('hit');
    expect(done.event_props?.bsr_source).toBe('rollup');
  });

  test('edge_cache=coalesced → 漏斗 coalesced 桶事件送達', async ({ page }) => {
    const payload = fakeChipsPayload({
      _cache_meta: { cache: 'coalesced', stamp_ver: 'v1', served_at: new Date().toISOString() },
    });
    await mockChipsWith(page, payload);
    const events = captureChipsEvents(page);

    await gotoWithRetry(page, '/e2e/chips-section?code=2330', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('chips-section').first().waitFor({ timeout: 15_000 });

    const done = await waitForEvent(events, 'chips_fetch_done');
    expect(done.event_props?.edge_cache).toBe('coalesced');
  });

  test('bsr_source=raw_fallback → 漏斗 DB fallback 桶事件送達（Phase E 訊號源）', async ({ page }) => {
    const payload = fakeChipsPayload({
      bsr_source: 'raw_fallback',
      bsr_fallback_used: true,
      _cache_meta: { cache: 'miss', stamp_ver: 'v1', served_at: new Date().toISOString() },
    });
    await mockChipsWith(page, payload);
    const events = captureChipsEvents(page);

    await gotoWithRetry(page, '/e2e/chips-section?code=2330', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('chips-section').first().waitFor({ timeout: 15_000 });

    const done = await waitForEvent(events, 'chips_fetch_done');
    expect(done.event_props?.edge_cache).toBe('miss');
    expect(done.event_props?.bsr_source).toBe('raw_fallback');
  });

  test('fetch 錯誤 → chips_fetch_error 事件送達（漏斗 error 桶）', async ({ page }) => {
    // 攔截 chips detail 回 500
    await page.route(/\/functions\/v1\/tw-chips-detail(\?|$)/, async (route: Route) => {
      await route.fulfill({ status: 500, contentType: 'text/plain', body: 'boom' });
    });
    await page.route(/\/functions\/v1\/traffic-ingest(\?|$)/, async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });
    const events = captureChipsEvents(page);

    await gotoWithRetry(page, '/e2e/chips-section?code=2330', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('chips-section').first().waitFor({ timeout: 15_000 });

    const err = await waitForEvent(events, 'chips_fetch_error', 8000);
    expect(err.event_props?.source).toBe('drawer_open');
    expect(err.event_props?.status).toBe(500);
  });
});
