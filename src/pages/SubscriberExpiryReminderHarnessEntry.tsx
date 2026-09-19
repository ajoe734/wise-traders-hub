/**
 * Preview-only harness：訂閱者到期 → 老師提醒（V2）。
 * Route: /e2e/subscriber-expiry-reminder-harness?scenario=due3&viewer=A
 *
 * 契約：掛載 production `ExpiringSubscribersBanner`（經同一個 `useExpiringSubscribers` seam，
 * 讀與寫都換成 fixture adapter）、production route builder `adminSignalsUrl`、
 * production `ReminderTimeDialog`、production `deliveryBadge`。
 * fixture 模式沒有任何 DB／Edge 呼叫，`db_writes` 恆為 0。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ExpiringSubscribersBanner } from '@/components/admin/ExpiringSubscribersBanner';
import { ReminderTimeDialog } from '@/pages/_companyAnalysts/ReminderTimeDialog';
import {
  ExpiringSubscribersSourceContext,
  EXPIRING_SUBSCRIBERS_QUERY_KEY,
  useExpiringSubscribers,
} from '@/hooks/useExpiringSubscribers';
import { adminSignalsUrl } from '@/lib/routes';
import {
  addDays,
  BUILD_MARKER,
  deliveryBadgeFor,
  emptyChannelsLedgerRow,
  EXPERTS,
  FIXTURE_LOCAL_DATE,
  createFixtureSource,
  emulateWorkerRuns,
  parseScenario,
  parseViewer,
  scenarioSubscriptions,
  type FixtureStore,
  type Scenario,
  type Viewer,
} from '@/pages/_subscriberExpiryHarness/fixtures';

function HarnessBody({ scenario, viewer, store }: { scenario: Scenario; viewer: Viewer; store: FixtureStore }) {
  const qc = useQueryClient();
  const expert = EXPERTS[viewer];
  const bannerRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(0);
  const [tick, force] = useState(0);
  const [dialogExpert, setDialogExpert] = useState<Record<string, unknown> | null>(null);
  const [dialogSaved, setDialogSaved] = useState<string>('');
  const [bannerKey, setBannerKey] = useState(0);

  // 與 banner 共用同一 query（react-query 同 key 只打一次），只為讀取 error 狀態呈現可理解錯誤
  const { error, isFetching } = useExpiringSubscribers(expert.id, true);

  // worker 模擬：dedupe scenario 跑兩次，其餘一次（同一 local_date）
  const worker = useMemo(
    () => emulateWorkerRuns(store.rows, scenario === 'dedupe' ? 2 : 1, store.localDate),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scenario, store.rows, store.localDate, tick],
  );
  const myNotifications = worker.notifications.filter((n) => n.user_id === expert.user_id);
  const dedupeCount = worker.runs.reduce((s, r) => s + r.deduped, 0);

  // visible_count 直接數 production banner 實際 render 的項目，不另算
  useEffect(() => {
    const el = bannerRef.current;
    if (!el) return;
    const count = () => setVisibleCount(el.querySelectorAll('[data-testid="expiring-subscriber-item"]').length);
    count();
    const mo = new MutationObserver(count);
    mo.observe(el, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);

  const refetch = async () => {
    await qc.invalidateQueries({ queryKey: [EXPIRING_SUBSCRIBERS_QUERY_KEY, expert.id] });
    force((n) => n + 1);
  };

  const renewAndRefresh = async () => {
    // 最新 fixture：續訂後到期日推到 30 天 → 不再落在 0–7 天
    store.rows = store.rows.map((r) => (r.owner_expert_id === expert.id ? { ...r, days_left: 30 } : r));
    // production 續訂後的刷新路徑：同 query key 失效 → hook 重新查權威資料（非 stale snapshot）
    await refetch();
  };

  const advanceDay = async () => {
    // 隔日：local_date 前進一天 → 「今天先收起」的 dismiss key 失效，橫幅重現
    store.localDate = addDays(store.localDate, 1);
    store.rows = store.rows.map((r) => ({ ...r }));
    setBannerKey((k) => k + 1); // 重掛 banner＝隔天重新進頁
    await refetch();
  };

  const errCode = String((error as { code?: string } | null)?.code || '');
  const errText = String((error as { message?: string } | null)?.message || error || '');
  const errMessage = error
    ? (errCode === 'PGRST202' || /schema cache|does not exist/i.test(errText)
      ? '尚未完成資料庫更新（找不到 expiring_subscriptions_for_expert），到期提醒暫時無法載入。'
      : `載入到期提醒失敗：${errText}`)
    : '';

  const status = error ? 'error' : isFetching ? 'loading' : 'ok';
  const route = adminSignalsUrl(expert.slug);
  const rpcCalls = store.ledger.rpc_calls;

  // channels={}（production 目前實況）→ 管理頁必須顯示「待送」，不可視為已送達
  const badge = deliveryBadgeFor([emptyChannelsLedgerRow('sub-1', FIXTURE_LOCAL_DATE)], 'sub-1', 3);

  return (
    <div id="subscriber-expiry-harness" style={{ padding: 16, fontFamily: 'monospace', fontSize: 13 }}>
      <div data-testid="build-marker">build_marker={BUILD_MARKER}</div>
      <div data-testid="scenario">scenario={scenario}</div>
      <div data-testid="viewer">viewer={viewer}</div>
      <div data-testid="local-date">local_date={store.localDate}</div>
      <div data-testid="visible-count">visible_count={visibleCount}</div>
      <div data-testid="notification-count">notification_count={myNotifications.length}</div>
      <div data-testid="dedupe-count">dedupe_count={dedupeCount}</div>
      <div data-testid="route">route={route}</div>
      <div data-testid="rpc-name">rpc_name={rpcCalls[0]?.name ?? ''}</div>
      <div data-testid="rpc-calls">rpc_calls={rpcCalls.length}</div>
      <div data-testid="ack-calls">ack_calls={store.ledger.ack_calls}</div>
      <div data-testid="ack-denied">ack_denied={store.ledger.ack_denied}</div>
      <div data-testid="db-writes">db_writes={store.ledger.db_writes}</div>
      <div data-testid="mutation-calls">mutation_calls={store.ledger.db_writes}</div>
      <div data-testid="status">status={status}</div>
      <div data-testid="worker-runs">worker_runs={JSON.stringify(worker.runs)}</div>
      <div data-testid="delivery-tone">delivery_tone={badge.tone}</div>
      <div data-testid="delivery-label">delivery_label={badge.label}</div>

      {errMessage && (
        <div data-testid="harness-error" role="alert" style={{ marginTop: 12, color: '#B4232A' }}>{errMessage}</div>
      )}

      <div ref={bannerRef} data-testid="banner-slot" style={{ marginTop: 16 }}>
        <ExpiringSubscribersBanner key={bannerKey} expertId={expert.id} expertSlug={expert.slug} enabled />
      </div>

      <ul data-testid="notification-list" style={{ marginTop: 16 }}>
        {myNotifications.map((n) => (
          <li key={n.id} data-testid="notification-item">
            <Link to={n.link} data-testid="notification-link">{n.title}</Link> → {n.link}
          </li>
        ))}
      </ul>

      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        {scenario === 'renewed' && (
          <button type="button" data-testid="renew-and-refresh" onClick={renewAndRefresh}>模擬續訂並重新整理</button>
        )}
        <button type="button" data-testid="advance-day" onClick={advanceDay}>模擬隔日重新進頁</button>
        <button type="button" data-testid="refetch" onClick={refetch}>重新查詢</button>
        <button type="button" data-testid="open-reminder-dialog" onClick={() => setDialogExpert({ ...expert, journal_reminder_time: '18:00:00', journal_reminder_timezone: 'Asia/Taipei' })}>
          開啟提醒時間設定
        </button>
      </div>
      <div data-testid="dialog-saved">dialog_saved={dialogSaved}</div>

      <ReminderTimeDialog
        expert={dialogExpert}
        saving={false}
        onClose={() => setDialogExpert(null)}
        onSave={async (_id, values) => {
          // fixture 模式：不寫 DB（db_writes 維持 0）；schema-error 重現 migration 未 apply
          if (store.schemaMissing) {
            throw new Error("Could not find the 'journal_reminder_time' column of 'experts' in the schema cache");
          }
          setDialogSaved(`${values.journal_reminder_time}@${values.journal_reminder_timezone}`);
          setDialogExpert(null);
        }}
      />
    </div>
  );
}

export default function SubscriberExpiryReminderHarnessEntry() {
  const params = new URLSearchParams(window.location.search);
  const scenario = parseScenario(params.get('scenario'));
  const viewer = parseViewer(params.get('viewer'));

  const [store] = useState<FixtureStore>(() => ({
    rows: scenarioSubscriptions(scenario),
    schemaMissing: scenario === 'schema-error',
    localDate: FIXTURE_LOCAL_DATE,
    ledger: { rpc_calls: [], db_writes: 0, ack_calls: 0, ack_denied: 0 },
  }));
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  const source = useMemo(() => createFixtureSource(store, viewer), [store, viewer]);

  return (
    <QueryClientProvider client={qc}>
      <ExpiringSubscribersSourceContext.Provider value={source}>
        <HarnessBody scenario={scenario} viewer={viewer} store={store} />
      </ExpiringSubscribersSourceContext.Provider>
    </QueryClientProvider>
  );
}
