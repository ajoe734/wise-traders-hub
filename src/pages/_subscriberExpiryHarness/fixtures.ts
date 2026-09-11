/**
 * Preview-only fixtures for /e2e/subscriber-expiry-reminder-harness.
 *
 * 零 DB／Edge 呼叫：`createFixtureSource` 以 in-memory 資料模擬 RPC
 * `expiring_subscriptions_for_expert`（含 owner 授權 42501 與 SQL 篩選條件），
 * 並記錄 consumer 實際嘗試的 RPC 名稱／次數。fixture 模式沒有任何寫入路徑，
 * `mutation_calls` 恆為 0。
 */
import type { ExpiringSubscribersSource } from '@/hooks/useExpiringSubscribers';
import { EXPIRING_SUBSCRIBERS_RPC } from '@/hooks/useExpiringSubscribers';
import type { ExpiringSubscriberRow } from '@/lib/subscriberExpiryReminder';
import { adminSignalsUrl } from '@/lib/routes';
import { reminderTitle } from '@/lib/subscriberExpiryReminder';
import { claimReminderLedger, SUBSCRIBER_EXPIRY_REMINDER_TYPE } from '@/lib/subscriberExpiryDedupe';

export const BUILD_MARKER = 'SUBSCRIBER_EXPIRY_PREVIEW_V1';
export const SCENARIOS = ['due3', 'excluded', 'cross-tenant', 'dedupe', 'renewed', 'schema-error'] as const;
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
}

function addDays(ymd: string, days: number): string {
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
    ...over,
  });
  switch (scenario) {
    case 'due3':
    case 'dedupe':
    case 'renewed':
    case 'schema-error':
    case 'cross-tenant':
      return [base({})];
    case 'excluded':
      return [
        base({ subscription_id: 'sub-8d', display_name: '八天', days_left: 8 }),
        base({ subscription_id: 'sub-canceled', display_name: '已取消', status: 'canceled', canceled_at: '2026-09-01T00:00:00Z' }),
        base({ subscription_id: 'sub-checkup', display_name: '健檢', product: 'checkup', plan_name: '持倉看板' }),
      ];
  }
}

/**
 * 模擬 SQL `expiring_subscriptions_for_expert(_expert_id)` 的可見條件：
 * 屬該老師、active、未取消、非健檢商品、0–7 天。
 * （權威實作在 DB；此處僅為 fixture adapter，不是 production 判斷邏輯。）
 */
export function emulateRpcRows(rows: FixtureSubscription[], expertId: string): ExpiringSubscriberRow[] {
  return rows
    .filter((r) => r.owner_expert_id === expertId
      && r.status === 'active'
      && r.canceled_at === null
      && r.product === 'subscription'
      && r.days_left >= 0 && r.days_left <= 7)
    .map((r) => {
      const expiresOn = addDays(FIXTURE_LOCAL_DATE, r.days_left);
      return {
        subscription_id: r.subscription_id,
        display_name: r.display_name,
        plan_name: r.plan_name,
        plan_type: r.plan_type,
        expires_at: `${expiresOn}T15:59:59.000Z`,
        expires_on: expiresOn,
        days_left: r.days_left,
        local_date: FIXTURE_LOCAL_DATE,
      };
    });
}

export interface HarnessLedger {
  rpc_calls: Array<{ name: string; args: Record<string, unknown> }>;
  mutation_calls: number;
}

export interface FixtureStore {
  rows: FixtureSubscription[];
  schemaMissing: boolean;
  ledger: HarnessLedger;
}

export class SchemaMissingError extends Error {
  code = 'PGRST202';
  constructor(fn: string) {
    super(`Could not find the function public.${fn} in the schema cache`);
  }
}

/** Fixture adapter：實作 production hook 的 source seam；只讀，無 mutation。 */
export function createFixtureSource(store: FixtureStore, viewer: Viewer): ExpiringSubscribersSource {
  return {
    rpcName: EXPIRING_SUBSCRIBERS_RPC,
    fetch: async (expertId) => {
      store.ledger.rpc_calls.push({ name: EXPIRING_SUBSCRIBERS_RPC, args: { _expert_id: expertId } });
      if (store.schemaMissing) throw new SchemaMissingError(EXPIRING_SUBSCRIBERS_RPC);
      // server-side ownership：非 owner 直接 42501（admin 稽核不在本 harness 範圍）
      if (expertId !== EXPERTS[viewer].id) {
        const err = new Error('permission denied: not owner of expert') as Error & { code: string };
        err.code = '42501';
        throw err;
      }
      return emulateRpcRows(store.rows, expertId);
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
export function emulateWorkerRuns(rows: FixtureSubscription[], times: number): WorkerEmulationResult {
  const ledger = new Set<string>();
  const notifications: HarnessNotification[] = [];
  const runs: WorkerEmulationResult['runs'] = [];
  for (let i = 0; i < times; i++) {
    const candidates = (Object.values(EXPERTS))
      .map((e) => ({ expert: e, items: emulateRpcRows(rows, e.id) }))
      .filter((x) => x.items.length > 0)
      .map((x) => ({ expert_id: x.expert.id, local_date: FIXTURE_LOCAL_DATE, reminder_type: SUBSCRIBER_EXPIRY_REMINDER_TYPE, expert: x.expert, items: x.items }));
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

export function parseScenario(raw: string | null): Scenario {
  return (SCENARIOS as readonly string[]).includes(raw || '') ? (raw as Scenario) : 'due3';
}

export function parseViewer(raw: string | null): Viewer {
  return raw === 'B' ? 'B' : 'A';
}
