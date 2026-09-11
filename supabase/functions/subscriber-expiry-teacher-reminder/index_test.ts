import { assert, assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { buildSubscriberExpiryTeacherReminder } from '../_shared/notificationTemplates.ts';
import { validateNotificationLink } from '../_shared/routes.ts';

// 只匯入純函式：index.ts 頂層有 Deno.serve，改用動態 import + stub
const realServe = Deno.serve;
(Deno as any).serve = () => ({}) as any;
const { runSubscriberExpiryReminders } = await import('./index.ts');
(Deno as any).serve = realServe;

function mockAdmin(claim: unknown, opts: { insertFail?: boolean } = {}) {
  const calls: string[] = [];
  const deleted: string[] = [];
  const inserted: unknown[] = [];
  const updated: unknown[] = [];
  const table = (name: string) => {
    const chain: any = {
      insert(row: unknown) { inserted.push(row); calls.push(`${name}.insert`); return chain; },
      select() { return chain; },
      single() { return Promise.resolve(opts.insertFail ? { data: null, error: { message: 'boom' } } : { data: { id: 'n-' + inserted.length }, error: null }); },
      delete() { calls.push(`${name}.delete`); return chain; },
      update(p: unknown) { updated.push(p); calls.push(`${name}.update`); return chain; },
      eq(_c: string, v: string) { if (calls.at(-1) === `${name}.delete`) deleted.push(v); return Promise.resolve({ data: null, error: null }); },
    };
    return chain;
  };
  return {
    admin: {
      rpc: (_fn: string, _a: Record<string, unknown>) => Promise.resolve({ data: claim, error: null }),
      from: table,
    },
    calls, deleted, inserted, updated,
  };
}

const batch = {
  ledger_id: 'L1', expert_id: 'E1', expert_user_id: 'U1', expert_name: '老周', expert_slug: 'zhou',
  local_date: '2026-09-11', subscription_count: 2,
  items: [
    { display_name: '小明', plan_name: '週記', expires_on: '2026/09/14', days_left: 3 },
    { display_name: '小美', plan_name: '週記', expires_on: '2026/09/11', days_left: 0 },
  ],
};

Deno.test('template：文案繁中、count 正確、link 為撰寫頁相對路徑、不含 email', () => {
  const row = buildSubscriberExpiryTeacherReminder({ teacherUserId: 'U1', expertSlug: 'zhou', items: batch.items });
  assertEquals(row.title, '2 位訂閱者將於 7 日內到期');
  assert(row.body.includes('小明') && row.body.includes('今日到期') && row.body.includes('剩 3 天'));
  assertEquals(row.type, 'subscriber_expiry_reminder');
  assertEquals(row.link, '/admin/zhou/signals');
  assertEquals(validateNotificationLink(row.link), null);
  assert(!JSON.stringify(row).includes('@'));
});

Deno.test('worker：claim 1 批 → created=1，ledger 回填 notification_id', async () => {
  const m = mockAdmin({ due_experts: 1, due_subscriptions: 2, claimed: 1, deduped: 0, batches: [batch] });
  const stats = await runSubscriberExpiryReminders(m.admin, '2026-09-11T10:30:00Z');
  assertEquals(stats.created, 1);
  assertEquals(stats.errors, 0);
  assertEquals(m.inserted.length, 1);
  assertEquals((m.updated[0] as any).notification_id, 'n-1');
});

Deno.test('worker：重跑 claim=0 deduped=1 → 不插入任何通知', async () => {
  const m = mockAdmin({ due_experts: 1, due_subscriptions: 2, claimed: 0, deduped: 1, batches: [] });
  const stats = await runSubscriberExpiryReminders(m.admin, '2026-09-11T10:30:00Z');
  assertEquals(stats.created, 0);
  assertEquals(stats.deduped, 1);
  assertEquals(m.inserted.length, 0);
});

Deno.test('worker：插入失敗 → errors=1 且釋放 ledger 讓下次重試', async () => {
  const m = mockAdmin({ due_experts: 1, due_subscriptions: 2, claimed: 1, deduped: 0, batches: [batch] }, { insertFail: true });
  const stats = await runSubscriberExpiryReminders(m.admin, '2026-09-11T10:30:00Z');
  assertEquals(stats.errors, 1);
  assertEquals(m.deleted, ['L1']);
});

Deno.test('worker：老師無 user_id → skipped 並釋放 ledger', async () => {
  const m = mockAdmin({ due_experts: 1, due_subscriptions: 1, claimed: 1, deduped: 0, batches: [{ ...batch, expert_user_id: null }] });
  const stats = await runSubscriberExpiryReminders(m.admin, '2026-09-11T10:30:00Z');
  assertEquals(stats.skipped, 1);
  assertEquals(m.inserted.length, 0);
  assertEquals(m.deleted, ['L1']);
});
