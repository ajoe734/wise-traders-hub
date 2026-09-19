import { assert, assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import {
  buildSubscriberExpiryTeacherReminder,
  buildSubscriberExpiryChurnReminder,
} from '../_shared/notificationTemplates.ts';
import { validateNotificationLink } from '../_shared/routes.ts';
import { buildTeacherEmail, buildTeacherLineText, headline, whenLabel } from '../_shared/subscriberExpiryChannels.ts';

// 只匯入純函式：index.ts 頂層有 Deno.serve，改用動態 import + stub
const realServe = Deno.serve;
(Deno as any).serve = () => ({}) as any;
const { runSubscriberExpiryReminders } = await import('./index.ts');
(Deno as any).serve = realServe;

type MockOpts = {
  insertFail?: boolean;
  rows?: Record<string, unknown>;
};

function mockAdmin(claim: unknown, opts: MockOpts = {}) {
  const inserted: Record<string, any[]> = {};
  const updated: Array<{ table: string; patch: any }> = [];
  const deleted: string[] = [];
  const table = (name: string) => {
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    const done = Promise.resolve({ data: null, error: null });
    const chain: any = {
      insert(row: any) { op = 'insert'; (inserted[name] ||= []).push(row); return chain; },
      update(patch: any) { op = 'update'; updated.push({ table: name, patch }); return chain; },
      delete() { op = 'delete'; return chain; },
      select() { return chain; },
      eq(_c: string, v: string) {
        if (op === 'delete') { deleted.push(v); return done; }
        if (op === 'update') return done;
        return chain;
      },
      is() { return chain; },
      gte() { return chain; },
      limit() { return chain; },
      maybeSingle() { return Promise.resolve({ data: (opts.rows || {})[name] ?? null, error: null }); },
      single() {
        return Promise.resolve(opts.insertFail
          ? { data: null, error: { message: 'boom' } }
          : { data: { id: 'n-' + (inserted[name] || []).length }, error: null });
      },
      then(res: any, rej: any) { return done.then(res, rej); },
    };
    return chain;
  };
  return {
    admin: {
      rpc: (_fn: string, _a: Record<string, unknown>) => Promise.resolve({ data: claim, error: null }),
      from: table,
      auth: { admin: { getUserById: (_id: string) => Promise.resolve({ data: { user: { email: 'teacher@example.com' } }, error: null }) } },
    },
    inserted, updated, deleted,
  };
}

const items = [
  { display_name: '小明', plan_name: '週記', expires_on: '2026/09/14', days_left: 3 },
  { display_name: '小美', plan_name: '週記', expires_on: '2026/09/11', days_left: 0 },
];

const batch = {
  ledger_id: 'L1', reminder_type: 'subscriber_expiry_7d', expert_id: 'E1', expert_user_id: 'U1',
  expert_name: '老周', expert_slug: 'zhou', local_date: '2026-09-11', subscription_count: 2, items,
};
const churnBatch = {
  ...batch, ledger_id: 'L2', reminder_type: 'subscriber_expiry_churn_24h',
  items: [{ display_name: '阿華', plan_name: '週記', expires_on: '2026/09/10', days_left: -1 }],
  subscription_count: 1,
};

const okDeps = () => ({
  teacherEmail: () => Promise.resolve('teacher@example.com'),
  sendEmail: () => Promise.resolve('sent' as const),
  pushLine: () => Promise.resolve('sent' as const),
  siteUrl: 'https://legendflow.tw',
  now: () => '2026-09-11T10:30:00Z',
});

Deno.test('template：7 日提醒文案繁中、link 為撰寫頁相對路徑、不含 email', () => {
  const row = buildSubscriberExpiryTeacherReminder({ teacherUserId: 'U1', expertSlug: 'zhou', items });
  assertEquals(row.title, '2 位訂閱者將於 7 日內到期');
  assert(row.body.includes('小明') && row.body.includes('今日到期') && row.body.includes('剩 3 天'));
  assertEquals(row.type, 'subscriber_expiry_reminder');
  assertEquals(row.link, '/admin/zhou/signals');
  assertEquals(validateNotificationLink(row.link), null);
  assert(!JSON.stringify(row).includes('@'));
});

Deno.test('template：過期 24 小時挽回提醒有自己的標題與建議', () => {
  const row = buildSubscriberExpiryChurnReminder({ teacherUserId: 'U1', expertSlug: 'zhou', items: churnBatch.items });
  assertEquals(row.title, '1 位訂閱者昨日到期未續訂');
  assert(row.body.includes('阿華') && row.body.includes('已過期'));
  assert(row.body.includes('24 小時內回購'));
  assertEquals(row.link, '/admin/zhou/signals');
});

Deno.test('文案單一資料源：Email 與 LINE 與站內共用標題／時間描述', () => {
  assertEquals(headline('subscriber_expiry_7d', 2), '2 位訂閱者將於 7 日內到期');
  assertEquals(headline('subscriber_expiry_churn_24h', 1), '1 位訂閱者昨日到期未續訂');
  assertEquals(whenLabel(-1), '已過期');
  assertEquals(whenLabel(0), '今日到期');
  assertEquals(whenLabel(1), '明日到期');
  assertEquals(whenLabel(5), '剩 5 天');
  const mail = buildTeacherEmail({ kind: 'subscriber_expiry_7d', expertName: '老周', items, actionUrl: 'https://legendflow.tw/admin/zhou/signals' });
  assert(mail.subject.includes('2 位訂閱者將於 7 日內到期'));
  assert(mail.html.includes('小明') && mail.html.includes('立即') === false);
  assert(mail.html.includes('前往撰寫週記'));
  assert(mail.text.includes('小美（週記・2026/09/11・今日到期）'));
  const line = buildTeacherLineText({ kind: 'subscriber_expiry_churn_24h', items: churnBatch.items, actionUrl: 'https://legendflow.tw/admin/zhou/signals' });
  assert(line.startsWith('1 位訂閱者昨日到期未續訂'));
  assert(line.includes('https://legendflow.tw/admin/zhou/signals'));
});

Deno.test('worker：一批 → 站內＋Email＋LINE 皆送出，ledger 寫入 channels', async () => {
  const m = mockAdmin({ due_experts: 1, due_subscriptions: 2, claimed: 1, deduped: 0, batches: [batch] });
  const stats = await runSubscriberExpiryReminders(m.admin as any, '2026-09-11T10:30:00Z', okDeps());
  assertEquals(stats.created, 1);
  assertEquals(stats.errors, 0);
  assertEquals(stats.channels, { inapp: 1, email: 1, line: 1, failed: 0 });
  assertEquals((m.inserted.notifications || []).length, 1);
  const link = m.updated.find((u) => u.patch.notification_id);
  assertEquals(link?.patch.notification_id, 'n-1');
  const chan = m.updated.find((u) => u.patch.channels)?.patch.channels;
  assertEquals(chan.inapp.state, 'sent');
  assertEquals(chan.email.state, 'sent');
  assertEquals(chan.line.state, 'sent');
  assertEquals(m.deleted.length, 0);
  // 每通道都留 audit log
  assertEquals((m.inserted.audit_logs || []).length, 3);
  assert((m.inserted.audit_logs || []).every((r: any) => r.action === 'subscriber_expiry.channel_sent'));
});

Deno.test('worker：churn 批次用挽回文案', async () => {
  const m = mockAdmin({ due_experts: 1, due_subscriptions: 1, claimed: 1, deduped: 0, batches: [churnBatch] });
  const stats = await runSubscriberExpiryReminders(m.admin as any, '2026-09-11T10:30:00Z', okDeps());
  assertEquals(stats.created, 1);
  assertEquals(m.inserted.notifications[0].title, '1 位訂閱者昨日到期未續訂');
  assertEquals((m.inserted.audit_logs || [])[0].detail.reminder_type, 'subscriber_expiry_churn_24h');
});

Deno.test('worker：重跑 claim=0 deduped=1 → 不插入任何通知', async () => {
  const m = mockAdmin({ due_experts: 1, due_subscriptions: 2, claimed: 0, deduped: 1, batches: [] });
  const stats = await runSubscriberExpiryReminders(m.admin as any, '2026-09-11T10:30:00Z', okDeps());
  assertEquals(stats.created, 0);
  assertEquals(stats.deduped, 1);
  assertEquals(m.inserted.notifications, undefined);
});

Deno.test('worker：Email 金鑰失效 → 站內仍成功、ledger 保留、失敗寫 audit_logs 與 system_alerts', async () => {
  const m = mockAdmin({ due_experts: 1, due_subscriptions: 2, claimed: 1, deduped: 0, batches: [batch] });
  const stats = await runSubscriberExpiryReminders(m.admin as any, '2026-09-11T10:30:00Z', {
    ...okDeps(),
    sendEmail: () => Promise.reject(new Error('resend 401: invalid api key')),
  });
  assertEquals(stats.created, 1);
  assertEquals(stats.channels.inapp, 1);
  assertEquals(stats.channels.email, 0);
  assertEquals(stats.channels.failed, 1);
  assertEquals(m.deleted.length, 0);
  const chan = m.updated.find((u) => u.patch.channels)?.patch.channels;
  assertEquals(chan.email.state, 'failed');
  assert(chan.email.error.includes('401'));
  assert((m.inserted.audit_logs || []).some((r: any) => r.action === 'subscriber_expiry.channel_failed' && r.detail.channel === 'email'));
  assertEquals((m.inserted.system_alerts || []).length, 1);
  assertEquals(m.inserted.system_alerts[0].kind, 'subscriber_expiry_channel_failure');
});

Deno.test('worker：老師沒 Email／沒綁 LINE → skipped，不算失敗、不告警', async () => {
  const m = mockAdmin({ due_experts: 1, due_subscriptions: 2, claimed: 1, deduped: 0, batches: [batch] });
  const stats = await runSubscriberExpiryReminders(m.admin as any, '2026-09-11T10:30:00Z', {
    ...okDeps(),
    teacherEmail: () => Promise.resolve(null),
    pushLine: () => Promise.resolve('skipped' as const),
  });
  assertEquals(stats.created, 1);
  assertEquals(stats.errors, 0);
  assertEquals(stats.channels.failed, 0);
  const chan = m.updated.find((u) => u.patch.channels)?.patch.channels;
  assertEquals(chan.email.reason, 'no_teacher_email');
  assertEquals(chan.line.reason, 'no_line_binding');
  assertEquals(m.inserted.system_alerts, undefined);
});

Deno.test('worker：三通道全失敗 → 釋放 ledger 讓下次重試', async () => {
  const m = mockAdmin({ due_experts: 1, due_subscriptions: 2, claimed: 1, deduped: 0, batches: [batch] }, { insertFail: true });
  const stats = await runSubscriberExpiryReminders(m.admin as any, '2026-09-11T10:30:00Z', {
    ...okDeps(),
    sendEmail: () => Promise.reject(new Error('resend 401')),
    pushLine: () => Promise.reject(new Error('line 401')),
  });
  assertEquals(stats.created, 0);
  assertEquals(stats.errors, 3);
  assertEquals(m.deleted, ['L1']);
});

Deno.test('worker：站內失敗但 Email 成功 → 不重試（ledger 保留），errors 計入', async () => {
  const m = mockAdmin({ due_experts: 1, due_subscriptions: 2, claimed: 1, deduped: 0, batches: [batch] }, { insertFail: true });
  const stats = await runSubscriberExpiryReminders(m.admin as any, '2026-09-11T10:30:00Z', okDeps());
  assertEquals(stats.errors, 1);
  assertEquals(stats.created, 1);
  assertEquals(m.deleted.length, 0);
});

Deno.test('worker：老師無 user_id → skipped 並釋放 ledger', async () => {
  const m = mockAdmin({ due_experts: 1, due_subscriptions: 1, claimed: 1, deduped: 0, batches: [{ ...batch, expert_user_id: null }] });
  const stats = await runSubscriberExpiryReminders(m.admin as any, '2026-09-11T10:30:00Z', okDeps());
  assertEquals(stats.skipped, 1);
  assertEquals(m.inserted.notifications, undefined);
  assertEquals(m.deleted, ['L1']);
});
