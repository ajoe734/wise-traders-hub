/**
 * Preview-only fixtures for /e2e/subscriber-expiry-reminder-harness（V2）。
 *
 * 零 DB／Edge 呼叫：`createFixtureSource` 以 in-memory 資料模擬 RPC
 * `expiring_subscriptions_for_expert`（含 owner 授權 42501 與 SQL 篩選條件）
 * 與寫入端 `ack_subscriber_expiry`（同樣先做 owner 授權），並記錄 consumer
 * 實際嘗試的 RPC 名稱／次數。fixture 的 ack 只改 in-memory store，
 * 真實 DB 寫入恆為 0（`db_writes`）。
 */
import type { ExpiringSubscribersSource } from '@/hooks/useExpiringSubscribers';
import { EXPIRING_SUBSCRIBERS_RPC, ACK_SUBSCRIBER_EXPIRY_RPC } from '@/hooks/useExpiringSubscribers';
import type { ExpiringSubscriberRow } from '@/lib/subscriberExpiryReminder';
import { adminSignalsUrl } from '@/lib/routes';
import { reminderTitle } from '@/lib/subscriberExpiryReminder';
import { claimReminderLedger, SUBSCRIBER_EXPIRY_REMINDER_TYPE } from '@/lib/subscriberExpiryDedupe';
import {
  buildDeliveryIndex,
  deliveryBadge,
  deliveryFor,
  type ExpiryReminderLedgerRow,
} from '@/lib/subscriberExpiryDelivery';

export const BUILD_MARKER = 'SUBSCRIBER_EXPIRY_PREVIEW_V2';
export const SCENARIOS = [
  'due3',
  'excluded',
  'cross-tenant',
  'cross-teacher-ack',
  'dedupe',
  'renewed',
  'ack',
  'dismiss-today',
  'channels-empty',
  'schema-error',
] as const;
export type Scenario = (typeof SCENARIOS)[number];
export type Viewer = 'A' | 'B';

/** 固定「今天」（老師時區本地日），fixture 不讀真實時鐘。 */
export const FIXTURE_LOCAL_DATE = '2026-09-11';

export const EXPERTS: Record<Viewer, { id: string; slug: string; name: string; user_id: string }> = {
  A: { id: 'expert-a', slug: 'teacher-a', name: '老師 A', user_id: 'user-a' },
  B: { id: 'expert-b', slug: 'teacher-b', name: '老師 B', user_id: 'user-b' },
};

/** 原始訂閱 fixture（對應 member_subscriptions → expert_plans → experts 鏈）。 */
export interface FixtureSubscription {
  subscription_id: string;
  owner_expert_id: string;
  display_name: string;
  plan_name: string;
  plan_type: 'mentor' | 'advisor';
  product: 'subscription' | 'checkup';
  status: 'active' | 'canceled' | 'expired';
  canceled_at: string | null;
  days_left: number;
  /** DB `subscriber_expiry_acks` 的鏡像：已聯繫 → 之後每次查詢都不再回傳。 */
  acked: boolean;
}

export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function scenarioSubscriptions(scenario: Scenario): FixtureSubscription[] {
  const base = (over: Partial<FixtureSubscription>): FixtureSubscription => ({
    subscription_id: 'sub-1',
    owner_expert_id: EXPERTS.A.id,
    display_name: '小明',
    plan_name: '修煉派',
    plan_type: 'mentor',
    product: 'subscription',
    status: 'active',
    canceled_at: null,
    days_left: 3,
    acked: false,
    ...over,
  });
  switch (scenario) {
    case 'due3':
    case 'dedupe':
    case 'renewed':
    case 'schema-error':
    case 'cross-tenant':
    case 'ack':
    case 'dismiss-today':
    case 'channels-empty':
      return [base({})];
    case 'cross-teacher-ack':
      // A 名下一位、B 名下一位：B 只能看到／只能 ack 自己的那位
      return [base({}), base({ subscription_id: 'sub-b1', owner_expert_id: EXPERTS.B.id, display_name: '阿華' })];
    case 'excluded':
      return [
        base({ subscription_id: 'sub-8d', display_name: '八天', days_left: 8 }),
        base({ subscription_id: 'sub-canceled', display_name: '已取消', status: 'canceled', canceled_at: '2026-09-01T00:00:00Z' }),
        base({ subscription_id: 'sub-checkup', display_name: '健檢', product: 'checkup', plan_name: '持倉看板' }),
        base({ subscription_id: 'sub-acked', display_name: '已聯繫', acked: true }),
      ];
  }
}

/**
 * 模擬 SQL `expiring_subscriptions_for_expert(_expert_id)` 的可見條件：
 * 屬該老師、active、未取消、非健檢商品、0–7 天、未被 ack。
 * （權威實作在 DB；此處僅為 fixture adapter，不是 production 判斷邏輯。）
 */
export function emulateRpcRows(
  rows: FixtureSubscription[],
  expertId: string,
  localDate: string = FIXTURE_LOCAL_DATE,
): ExpiringSubscriberRow[] {
  return rows
    .filter((r) => r.owner_expert_id === expertId
      && r.status === 'active'
      && r.canceled_at === null
      && r.product === 'subscription'
      && !r.acked
      && r.days_left >= 0 && r.days_left <= 7)
    .map((r) => {
      const expiresOn = addDays(localDate, r.days_left);
      return {
        subscription_id: r.subscription_id,
        display_name: r.display_name,
        plan_name: r.plan_name,
        plan_type: r.plan_type,
        expires_at: `${expiresOn}T15:59:59.000Z`,
        expires_on: expiresOn,
        days_left: r.days_left,
        local_date: localDate,
      };
    });
}

export interface HarnessLedger {
  rpc_calls: Array<{ name: string; args: Record<string, unknown> }>;
  /** 真實 DB 寫入次數（fixture 永遠 0）。 */
  db_writes: number;
  /** fixture in-memory ack 次數（成功／被拒都記）。 */
  ack_calls: number;
  ack_denied: number;
}

export interface FixtureStore {
  rows: FixtureSubscription[];
  schemaMissing: boolean;
  localDate: string;
  ledger: HarnessLedger;
}

export class SchemaMissingError extends Error {
  code = 'PGRST202';
  constructor(fn: string) {
    super(`Could not find the function public.${fn} in the schema cache`);
  }
}

function denied(): Error & { code: string } {
  const err = new Error('permission denied: not owner of expert') as Error & { code: string };
  err.code = '42501';
  return err;
}

/** Fixture adapter：實作 production hook 的 source seam；ack 只改 in-memory store。 */
export function createFixtureSource(store: FixtureStore, viewer: Viewer): ExpiringSubscribersSource {
  return {
    rpcName: EXPIRING_SUBSCRIBERS_RPC,
    ackRpcName: ACK_SUBSCRIBER_EXPIRY_RPC,
    fetch: async (expertId) => {
      store.ledger.rpc_calls.push({ name: EXPIRING_SUBSCRIBERS_RPC, args: { _expert_id: expertId } });
      if (store.schemaMissing) throw new SchemaMissingError(EXPIRING_SUBSCRIBERS_RPC);
      // server-side ownership：非 owner 直接 42501（admin 稽核不在本 harness 範圍）
      if (expertId !== EXPERTS[viewer].id) throw denied();
      return emulateRpcRows(store.rows, expertId, store.localDate);
    },
    ack: async (subscriptionId) => {
      store.ledger.rpc_calls.push({ name: ACK_SUBSCRIBER_EXPIRY_RPC, args: { _subscription_id: subscriptionId, _ack: true } });
      store.ledger.ack_calls += 1;
      const row = store.rows.find((r) => r.subscription_id === subscriptionId);
      // server-side：只有該訂閱所屬老師（或 company admin）可標記，其餘 42501
      if (!row || row.owner_expert_id !== EXPERTS[viewer].id) {
        store.ledger.ack_denied += 1;
        throw denied();
      }
      row.acked = true;
    },
  };
}

export interface HarnessNotification {
  id: string;
  user_id: string;
  type: 'subscriber_expiry_reminder';
  title: string;
  link: string;
  local_date: string;
  reminder_type: string;
}

export interface WorkerEmulationResult {
  notifications: HarnessNotification[];
  runs: Array<{ created: number; deduped: number; due_experts: number }>;
}

/**
 * 模擬 worker 在同一 local_date 跑 `times` 次：
 * claim 走 production dedupe 契約（`claimReminderLedger` ＝ ledger UNIQUE + ON CONFLICT DO NOTHING），
 * 通知 row 的 link 走 production route builder `adminSignalsUrl`。
 */
export function emulateWorkerRuns(
  rows: FixtureSubscription[],
  times: number,
  localDate: string = FIXTURE_LOCAL_DATE,
): WorkerEmulationResult {
  const ledger = new Set<string>();
  const notifications: HarnessNotification[] = [];
  const runs: WorkerEmulationResult['runs'] = [];
  for (let i = 0; i < times; i++) {
    const candidates = (Object.values(EXPERTS))
      .map((e) => ({ expert: e, items: emulateRpcRows(rows, e.id, localDate) }))
      .filter((x) => x.items.length > 0)
      .map((x) => ({ expert_id: x.expert.id, local_date: localDate, reminder_type: SUBSCRIBER_EXPIRY_REMINDER_TYPE, expert: x.expert, items: x.items }));
    const outcome = claimReminderLedger(ledger, candidates);
    for (const c of outcome.claimed) {
      notifications.push({
        id: `n-${c.expert_id}-${c.local_date}`,
        user_id: c.expert.user_id,
        type: 'subscriber_expiry_reminder',
        title: reminderTitle(c.items.length),
        link: adminSignalsUrl(c.expert.slug),
        local_date: c.local_date,
        reminder_type: c.reminder_type,
      });
    }
    runs.push({ created: outcome.claimed.length, deduped: outcome.deduped, due_experts: outcome.due_experts });
  }
  return { notifications, runs };
}

/**
 * `subscriber_expiry_reminders.channels = {}`（production 目前 5 筆的實況）：
 * 沒有任何通道事件 → 管理頁不可標成已送達，必須是「待送」。
 */
export function emptyChannelsLedgerRow(subscriptionId: string, localDate: string): ExpiryReminderLedgerRow {
  return {
    expert_id: EXPERTS.A.id,
    local_date: localDate,
    reminder_type: SUBSCRIBER_EXPIRY_REMINDER_TYPE,
    payload: [{ subscription_id: subscriptionId }],
    channels: {},
    created_at: `${localDate}T10:05:00.000Z`,
  };
}

/** 管理頁「通知老師」欄位的 production 判斷（channels={} → 待送）。 */
export function deliveryBadgeFor(rowsLedger: ExpiryReminderLedgerRow[], subscriptionId: string, daysLeft: number) {
  const index = buildDeliveryIndex(rowsLedger);
  return deliveryBadge({
    summary: deliveryFor(index, subscriptionId),
    status: 'expiring',
    remainingDays: daysLeft,
    formatDate: (iso) => iso.slice(0, 10).replace(/-/g, '/'),
  });
}

export function parseScenario(raw: string | null): Scenario {
  return (SCENARIOS as readonly string[]).includes(raw || '') ? (raw as Scenario) : 'due3';
}

export function parseViewer(raw: string | null): Viewer {
  return raw === 'B' ? 'B' : 'A';
}
