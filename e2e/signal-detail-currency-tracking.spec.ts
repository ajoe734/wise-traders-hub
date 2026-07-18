import { test, expect, type Page, type Route } from '@playwright/test';
import { seedSession, installRoutes } from './helpers/supabase-mock';

/**
 * 攔截 trackRaw → traffic-ingest 的實際網路請求，斷言 SignalDetail 在
 * currency 缺失時送出的 `signal_currency_resolution` 事件：
 *   - source 為 'inferred-instrument'（能從代號判斷市場）或 'default-fallback'（無法判斷）
 *   - had_explicit === false
 *   - resolved_currency 與 instrument 對應（AAPL→USD、2330→TWD、未知→TWD 預設）
 * 同時確認頁面正常渲染，無錯誤邊界 fallback。
 */

const EXPERT_SLUG = 'currency-tracker-expert';
const USER_ID = 'user-currency-tracker';

interface TrackedEvent {
  name: string;
  props: Record<string, unknown> | null;
}

async function captureTrackingEvents(page: Page): Promise<TrackedEvent[]> {
  const collected: TrackedEvent[] = [];

  // 覆蓋 sendBeacon（trafficTracker 優先走這條）與 fetch，兩者都導向 window.__lovableTracked
  await page.addInitScript(() => {
    (window as unknown as { __lovableTracked: unknown[] }).__lovableTracked = [];
    const push = (raw: unknown) => {
      try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        (window as unknown as { __lovableTracked: unknown[] }).__lovableTracked.push(parsed);
      } catch {
        /* noop */
      }
    };
    const originalBeacon = navigator.sendBeacon?.bind(navigator);
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      value: (url: string, data?: BodyInit) => {
        if (typeof url === 'string' && url.includes('/traffic-ingest')) {
          if (data instanceof Blob) {
            data.text().then(push).catch(() => {});
          } else if (typeof data === 'string') {
            push(data);
          }
          return true;
        }
        return originalBeacon ? originalBeacon(url, data) : true;
      },
    });
  });

  // 保險：直接攔截 HTTP 端點（sendBeacon 若被瀏覽器忽略時走 fetch）
  await page.route('**/functions/v1/traffic-ingest', async (route: Route) => {
    try {
      const body = route.request().postData();
      if (body) {
        const parsed = JSON.parse(body);
        collected.push({ name: '__http__', props: parsed });
      }
    } catch { /* noop */ }
    await route.fulfill({ status: 204, body: '' });
  });

  // 匯出集合供測試 assert 時取 sendBeacon 攔到的事件
  (page as unknown as { __httpCollected: TrackedEvent[] }).__httpCollected = collected;
  return collected;
}

async function readTracked(page: Page): Promise<Record<string, unknown>[]> {
  const beaconed = await page.evaluate(() =>
    (window as unknown as { __lovableTracked?: unknown[] }).__lovableTracked ?? [],
  );
  const httpCollected =
    (page as unknown as { __httpCollected?: TrackedEvent[] }).__httpCollected ?? [];
  const httpPayloads = httpCollected.map((c) => c.props).filter(Boolean) as Record<string, unknown>[];
  return [...(beaconed as Record<string, unknown>[]), ...httpPayloads];
}

/** 從 traffic-ingest payload 中撈出所有 signal_currency_resolution 事件 props。 */
function extractCurrencyEvents(payloads: Record<string, unknown>[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const p of payloads) {
    const events = (p?.events ?? p?.batch ?? []) as unknown[];
    if (!Array.isArray(events)) continue;
    for (const ev of events) {
      if (!ev || typeof ev !== 'object') continue;
      const rec = ev as Record<string, unknown>;
      if (rec.name === 'signal_currency_resolution' || rec.event_name === 'signal_currency_resolution') {
        const props = (rec.props ?? rec.event_props ?? {}) as Record<string, unknown>;
        out.push(props);
      }
    }
  }
  return out;
}

type Case = {
  label: string;
  signalId: string;
  instrument: string;
  expertCurrency: string | null;
  expectedSource: 'inferred-instrument' | 'default-fallback';
  expectedCurrency: string;
};

const cases: Case[] = [
  {
    label: '無 currency，AAPL → 推斷 USD',
    signalId: 'sig-track-aapl',
    instrument: 'AAPL Apple',
    expertCurrency: null,
    expectedSource: 'inferred-instrument',
    expectedCurrency: 'USD',
  },
  {
    label: '無 currency，2330 → 推斷 TWD',
    signalId: 'sig-track-2330',
    instrument: '2330 台積電',
    expertCurrency: null,
    expectedSource: 'inferred-instrument',
    expectedCurrency: 'TWD',
  },
  {
    label: '無 currency 且無法從代號判斷 → 預設 TWD fallback',
    signalId: 'sig-track-unknown',
    instrument: '未命名商品',
    expertCurrency: null,
    expectedSource: 'default-fallback',
    expectedCurrency: 'TWD',
  },
];

async function setupMocks(page: Page, c: Case) {
  await seedSession(page, { id: USER_ID, email: 'currency-tracker@example.com' });
  await installRoutes(page, {
    rest: {
      profiles: () => [{
        display_name: '追蹤者',
        expert_slug: EXPERT_SLUG,
        avatar_url: null,
        line_user_id: null,
        is_tester: false,
        merged_into_user_id: null,
      }],
      user_roles: () => [{ user_id: USER_ID, role: 'company_admin' }],
      experts: () => [{
        id: 'expert-currency-tracker',
        name: 'Currency Tracker',
        role: 'mentor',
        slug: EXPERT_SLUG,
        currency: c.expertCurrency,
      }],
      expert_signals: () => ({
        id: c.signalId,
        instrument: c.instrument,
        action: 'buy',
        price_hint: 100,
        quantity: 1,
        quantity_unit: '股',
        reason_summary: '幣別缺失追蹤測試',
        reason_detail: null,
        risk_notes: null,
        learning_points: null,
        published_at: new Date().toISOString(),
        experts: {
          name: 'Currency Tracker',
          slug: EXPERT_SLUG,
          role: 'mentor',
          avatar_url: null,
          currency: c.expertCurrency,
        },
      }),
      subscription_timeline: () => [],
      subscriptions: () => [],
    },
  });
}

for (const c of cases) {
  test(`SignalDetail 幣別追蹤：${c.label}`, async ({ page }) => {
    await captureTrackingEvents(page);
    await setupMocks(page, c);

    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto(`/app/signal/${c.signalId}?preview=1`);

    // 1) 頁面正常渲染
    await expect(page.getByText(new RegExp(c.instrument.split(' ')[0]))).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('訊號內容暫時無法顯示')).toHaveCount(0);
    await expect(page.getByText(/內容暫時無法顯示|尚未訂閱|找不到此訊號/i)).toHaveCount(0);
    expect(pageErrors, `pageerror: ${pageErrors.join(' | ')}`).toEqual([]);

    // 2) 觸發 flush（trafficTracker 在 visibilitychange=hidden / pagehide 時 flush）
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pagehide'));
    });

    // 3) 輪詢等 signal_currency_resolution 事件送出
    let matched: Record<string, unknown> | undefined;
    for (let i = 0; i < 20; i++) {
      const payloads = await readTracked(page);
      const evts = extractCurrencyEvents(payloads);
      matched = evts.find((e) => e.signal_id === c.signalId);
      if (matched) break;
      await page.waitForTimeout(150);
    }

    expect(matched, `未收到 signal_id=${c.signalId} 的 signal_currency_resolution 事件`).toBeTruthy();
    expect(matched?.source).toBe(c.expectedSource);
    expect(matched?.resolved_currency).toBe(c.expectedCurrency);
    expect(matched?.had_explicit).toBe(false);
    expect(matched?.is_preview).toBe(true);
  });
}
