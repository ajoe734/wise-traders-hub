/**
 * B 階段 consumer integration tests（SUBSCRIBER_EXPIRY_PREVIEW_V2）。
 *
 * 兩個真正的 production consumer：
 *  1. 通知中心 `src/pages/account/Notifications.tsx`（讀 notifications table，
 *     到期提醒 row 由 V2 fixture 的 worker 模擬產生，link 走 production `adminSignalsUrl`）。
 *  2. 週記頁 `/admin/:expertSlug/signals` 掛載的 production `ExpiringSubscribersBanner`
 *     （走 `useExpiringSubscribers` seam，讀寫皆注入 fixture adapter）。
 *
 * 零真實 DB／Edge／通知：supabase client 全程被 mock，fixture ack 只改 in-memory store。
 */
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// ---- shared mocks -----------------------------------------------------------
const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

const authUser = { id: 'user-a', email: 'a@example.com', expertSlug: 'teacher-a' };
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: authUser, hasRole: () => false, loading: false }),
}));

vi.mock('@/lib/analytics/events', () => ({ trackRaw: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

interface DbState {
  notifications: Array<Record<string, unknown>>;
  eqCalls: Array<{ table: string; col: string; val: unknown }>;
  writes: Array<{ table: string; patch: unknown }>;
}
const db: DbState = { notifications: [], eqCalls: [], writes: [] };

vi.mock('@/integrations/supabase/client', () => {
  const from = (table: string) => {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: (col: string, val: unknown) => { db.eqCalls.push({ table, col, val }); return b; },
      order: () => b,
      limit: () => Promise.resolve({ data: table === 'notifications' ? db.notifications : [], error: null }),
      maybeSingle: () => Promise.resolve({
        data: table === 'profiles' ? { line_user_id: null } : null,
        error: null,
      }),
      update: (patch: unknown) => { db.writes.push({ table, patch }); return b; },
      upsert: (patch: unknown) => { db.writes.push({ table, patch }); return Promise.resolve({ error: null }); },
      then: (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(res),
    });
    return b;
  };
  return { supabase: { from, rpc: vi.fn(async () => ({ data: null, error: new Error('rpc must not be called') })) } };
});

import AccountNotifications from '@/pages/account/Notifications';
import { ExpiringSubscribersBanner } from '@/components/admin/ExpiringSubscribersBanner';
import { ExpiringSubscribersSourceContext } from '@/hooks/useExpiringSubscribers';
import { adminSignalsUrl } from '@/lib/routes';
import {
  BUILD_MARKER,
  EXPERTS,
  FIXTURE_LOCAL_DATE,
  addDays,
  createFixtureSource,
  deliveryBadgeFor,
  emptyChannelsLedgerRow,
  emulateWorkerRuns,
  scenarioSubscriptions,
  type FixtureStore,
  type Viewer,
} from '@/pages/_subscriberExpiryHarness/fixtures';

const ROOT = path.resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

function notificationRows(runs: number) {
  const rows = [
    ...scenarioSubscriptions('due3'),
    // 老師 B 名下也有一位到期訂閱者 → worker 會為 B 另外產生一筆通知
    { ...scenarioSubscriptions('due3')[0], subscription_id: 'sub-b1', owner_expert_id: EXPERTS.B.id, display_name: '阿華' },
  ];
  return emulateWorkerRuns(rows, runs, FIXTURE_LOCAL_DATE);
}

function toDbNotification(n: { id: string; user_id: string; type: string; title: string; link: string }) {
  return {
    id: n.id,
    user_id: n.user_id,
    type: n.type,
    title: n.title,
    body: null,
    link: n.link,
    is_read: false,
    created_at: `${FIXTURE_LOCAL_DATE}T10:05:00.000Z`,
    download_url: null,
  };
}

function renderNotificationCenter() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/account/notifications']}>
        <AccountNotifications />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  db.notifications = [];
  db.eqCalls = [];
  db.writes = [];
  navigate.mockClear();
  localStorage.clear();
});
afterEach(() => cleanup());

// ---- consumer 1：真正的通知中心 ------------------------------------------------
describe('consumer：通知中心（/account/notifications）顯示到期提醒', () => {
  it('顯示 worker 產生的到期提醒（標題來自 production reminderTitle）並標記未讀', async () => {
    const { notifications } = notificationRows(1);
    const mine = notifications.filter((n) => n.user_id === EXPERTS.A.user_id);
    expect(mine).toHaveLength(1);
    db.notifications = mine.map(toDbNotification);

    renderNotificationCenter();

    expect(await screen.findByText('1 位訂閱者將於 7 日內到期')).toBeTruthy();
    expect(screen.getByText('1 未讀')).toBeTruthy();
  });

  it('查詢以 user_id 收斂：老師 B 的通知不會出現在老師 A 的通知中心', async () => {
    const { notifications } = notificationRows(1);
    // 只餵 A 的 row（等同 DB 依 user_id 篩選後的結果）
    db.notifications = notifications.filter((n) => n.user_id === EXPERTS.A.user_id).map(toDbNotification);
    const bTitle = notifications.find((n) => n.user_id === EXPERTS.B.user_id);
    expect(bTitle).toBeTruthy();
    expect(bTitle!.link).toBe(adminSignalsUrl(EXPERTS.B.slug));

    renderNotificationCenter();
    await screen.findByText('1 位訂閱者將於 7 日內到期');

    const notifEq = db.eqCalls.filter((c) => c.table === 'notifications');
    expect(notifEq.some((c) => c.col === 'user_id' && c.val === 'user-a')).toBe(true);
    expect(notifEq.some((c) => c.val === EXPERTS.B.user_id)).toBe(false);
    // B 的通知不在畫面上（畫面只有一則）
    expect(screen.getAllByText('1 位訂閱者將於 7 日內到期')).toHaveLength(1);
  });

  it('點擊到期提醒會標記已讀並導向 production 週記頁路徑 /admin/:slug/signals', async () => {
    const { notifications } = notificationRows(1);
    db.notifications = notifications.filter((n) => n.user_id === EXPERTS.A.user_id).map(toDbNotification);

    renderNotificationCenter();
    fireEvent.click(await screen.findByText('1 位訂閱者將於 7 日內到期'));

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(navigate.mock.calls[0][0]).toBe(adminSignalsUrl(EXPERTS.A.slug));
    expect(db.writes.some((w) => w.table === 'notifications' && (w.patch as { is_read?: boolean }).is_read === true)).toBe(true);
  });

  it('同一天 worker 重跑不會在通知中心產生第二則（dedupe 契約）', async () => {
    const { notifications, runs } = notificationRows(2);
    expect(runs[1]).toMatchObject({ created: 0, deduped: 2 });
    db.notifications = notifications.filter((n) => n.user_id === EXPERTS.A.user_id).map(toDbNotification);

    renderNotificationCenter();
    await screen.findByText('1 位訂閱者將於 7 日內到期');
    expect(screen.getAllByText('1 位訂閱者將於 7 日內到期')).toHaveLength(1);
  });
});

// ---- consumer 2：週記頁 /admin/:slug/signals ---------------------------------
function renderBanner(scenario: Parameters<typeof scenarioSubscriptions>[0], viewer: Viewer) {
  const store: FixtureStore = {
    rows: scenarioSubscriptions(scenario),
    schemaMissing: false,
    localDate: FIXTURE_LOCAL_DATE,
    ledger: { rpc_calls: [], db_writes: 0, ack_calls: 0, ack_denied: 0 },
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const expert = EXPERTS[viewer];
  const ui = (
    <QueryClientProvider client={qc}>
      <ExpiringSubscribersSourceContext.Provider value={createFixtureSource(store, viewer)}>
        <MemoryRouter initialEntries={[adminSignalsUrl(expert.slug)]}>
          <ExpiringSubscribersBanner expertId={expert.id} expertSlug={expert.slug} enabled />
        </MemoryRouter>
      </ExpiringSubscribersSourceContext.Provider>
    </QueryClientProvider>
  );
  const view = render(ui);
  return { store, qc, expert, view, ui };
}

describe('consumer：週記頁 /admin/:slug/signals 的到期橫幅', () => {
  it('週記頁與撰寫頁都掛載 production 橫幅（seam 接線）', () => {
    for (const f of ['src/pages/admin/Signals.tsx', 'src/pages/admin/SignalEditor.tsx']) {
      const src = read(f);
      expect(src).toContain("import { ExpiringSubscribersBanner } from '@/components/admin/ExpiringSubscribersBanner'");
      expect(src).toMatch(/<ExpiringSubscribersBanner[\s\S]*?expertId=/);
    }
    // 橫幅只經 seam 取資料，不自己打 supabase
    const banner = read('src/components/admin/ExpiringSubscribersBanner.tsx');
    expect(banner).not.toContain('@/integrations/supabase/client');
    expect(banner).toContain('useExpiringSubscribersSource');
    expect(BUILD_MARKER).toBe('SUBSCRIBER_EXPIRY_PREVIEW_V2');
  });

  it('「已聯繫」走 ack RPC，重新查詢後該訂閱者持續消失', async () => {
    const { store, qc, expert } = renderBanner('due3', 'A');
    expect(await screen.findByTestId('expiring-subscribers-banner')).toBeTruthy();
    expect(screen.getAllByTestId('expiring-subscriber-item')).toHaveLength(1);

    fireEvent.click(screen.getByTestId('ack-subscriber'));
    await waitFor(() => expect(store.ledger.ack_calls).toBe(1));
    expect(store.ledger.rpc_calls.some((c) => c.name === 'ack_subscriber_expiry')).toBe(true);
    await waitFor(() => expect(screen.queryByTestId('expiring-subscribers-banner')).toBeNull());

    // 再次查詢（等同重新進頁）：DB 端 acked → 仍然不出現
    await qc.invalidateQueries();
    await waitFor(() => expect(screen.queryByTestId('expiring-subscribers-banner')).toBeNull());
    expect(store.rows.find((r) => r.owner_expert_id === expert.id)?.acked).toBe(true);
    expect(store.ledger.db_writes).toBe(0);
  });

  it('跨老師 ack 被 server 以 42501 拒絕，該列仍留在名單上', async () => {
    const store: FixtureStore = {
      rows: scenarioSubscriptions('cross-teacher-ack'),
      schemaMissing: false,
      localDate: FIXTURE_LOCAL_DATE,
      ledger: { rpc_calls: [], db_writes: 0, ack_calls: 0, ack_denied: 0 },
    };
    // viewer 是 B，但硬塞 A 的訂閱 id（模擬前端被竄改）：server-side 授權必須擋下
    const source = createFixtureSource(store, 'B');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ExpiringSubscribersSourceContext.Provider
          value={{ ...source, fetch: async () => source.fetch(EXPERTS.B.id) }}
        >
          <MemoryRouter initialEntries={[adminSignalsUrl(EXPERTS.B.slug)]}>
            <ExpiringSubscribersBanner expertId={EXPERTS.B.id} expertSlug={EXPERTS.B.slug} enabled />
          </MemoryRouter>
        </ExpiringSubscribersSourceContext.Provider>
      </QueryClientProvider>,
    );

    await screen.findByTestId('expiring-subscribers-banner');
    await expect(source.ack!('sub-1', EXPERTS.B.id)).rejects.toMatchObject({ code: '42501' });
    expect(store.ledger.ack_denied).toBe(1);
    expect(store.rows.find((r) => r.subscription_id === 'sub-1')?.acked).toBe(false);
    // B 只看得到自己的那位
    expect(screen.getAllByTestId('expiring-subscriber-item')).toHaveLength(1);
    expect(screen.getByText('阿華')).toBeTruthy();
  });

  it('跨 tenant：不是自己的 expertId 直接被 42501 擋下，橫幅不顯示', async () => {
    const store: FixtureStore = {
      rows: scenarioSubscriptions('cross-tenant'),
      schemaMissing: false,
      localDate: FIXTURE_LOCAL_DATE,
      ledger: { rpc_calls: [], db_writes: 0, ack_calls: 0, ack_denied: 0 },
    };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ExpiringSubscribersSourceContext.Provider value={createFixtureSource(store, 'B')}>
          <MemoryRouter initialEntries={[adminSignalsUrl(EXPERTS.A.slug)]}>
            <ExpiringSubscribersBanner expertId={EXPERTS.A.id} expertSlug={EXPERTS.A.slug} enabled />
          </MemoryRouter>
        </ExpiringSubscribersSourceContext.Provider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(store.ledger.rpc_calls.length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.queryByTestId('expiring-subscribers-banner')).toBeNull());
  });

  it('續訂後（不再落在 0–7 天）橫幅消失', async () => {
    const { store, qc } = renderBanner('renewed', 'A');
    await screen.findByTestId('expiring-subscribers-banner');
    store.rows = store.rows.map((r) => ({ ...r, days_left: 30 }));
    await qc.invalidateQueries();
    await waitFor(() => expect(screen.queryByTestId('expiring-subscribers-banner')).toBeNull());
  });

  it('「今天先收起」只當日隱藏，隔日重新進頁會再出現', async () => {
    const { store, ui } = renderBanner('dismiss-today', 'A');
    await screen.findByTestId('expiring-subscribers-banner');
    fireEvent.click(screen.getByLabelText('今天先收起'));
    await waitFor(() => expect(screen.queryByTestId('expiring-subscribers-banner')).toBeNull());
    expect(JSON.parse(localStorage.getItem('lf.expiringSubscribersBanner.v1') || '{}').dismissed)
      .toContain(`${EXPERTS.A.id}:${FIXTURE_LOCAL_DATE}`);

    // 同一天重新進頁：仍然隱藏
    cleanup();
    render(ui);
    await waitFor(() => expect(screen.queryByTestId('expiring-subscribers-banner')).toBeNull());

    // 隔日：local_date 前進 → dismiss key 失效，橫幅重現
    cleanup();
    store.localDate = addDays(store.localDate, 1);
    render(ui);
    expect(await screen.findByTestId('expiring-subscribers-banner')).toBeTruthy();
  });

  it('channels={} 的提醒紀錄必須標為「待送」，不可視為已送達', () => {
    const badge = deliveryBadgeFor([emptyChannelsLedgerRow('sub-1', FIXTURE_LOCAL_DATE)], 'sub-1', 3);
    expect(badge.tone).toBe('pending');
    expect(badge.label).toContain('待送');
  });
});
