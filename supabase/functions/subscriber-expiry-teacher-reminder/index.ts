// AUTH: cron
// 訂閱者到期 → 老師端提醒（站內 + Email + LINE 三通道 fan-out）。
// 名單 / 時間門 / dedupe 全在 DB RPC `claim_subscriber_expiry_reminders`（一次 query，無 N+1）；
// 兩種提醒：subscriber_expiry_7d（0–7 天內到期）與 subscriber_expiry_churn_24h（昨日到期未續訂）。
// 本函式負責：claim → 建文案 → 三通道各自 try/catch 送出 → 回填 ledger.channels → 失敗寫 audit_logs 並告警。
// 三通道全失敗才刪 ledger row 讓下次重試；只要站內成功就保留（同日同老師同類型最多一則）。
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { corsPreflight, jsonResponse } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/supabaseClients.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
import {
  buildSubscriberExpiryTeacherReminder,
  buildSubscriberExpiryChurnReminder,
  type SubscriberExpiryItem,
} from '../_shared/notificationTemplates.ts';
import { adminSignalsUrl } from '../_shared/routes.ts';
import { sendAppEmail } from '../_shared/mailer.ts';
import {
  buildTeacherEmail,

  buildTeacherLineText,
  allFailed,
  hasFailure,
  isChurnKind,
  type ChannelMap,
  type ChannelResult,
  type ReminderKind,
} from '../_shared/subscriberExpiryChannels.ts';

export type ClaimBatch = {
  ledger_id: string;
  reminder_type?: ReminderKind;
  expert_id: string;
  expert_user_id: string | null;
  expert_name: string | null;
  expert_slug: string | null;
  local_date: string;
  subscription_count: number;
  items: SubscriberExpiryItem[];
};

export type ClaimResult = {
  due_experts: number;
  due_subscriptions: number;
  claimed: number;
  deduped: number;
  batches: ClaimBatch[];
};

export type RunStats = {
  processed: number;
  created: number;
  deduped: number;
  skipped: number;
  errors: number;
  error_samples: string[];
  channels: { inapp: number; email: number; line: number; failed: number };
};

type MinimalAdmin = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  from: (table: string) => any;
  auth?: { admin?: { getUserById: (id: string) => PromiseLike<{ data: any; error: any }> } };
};

export type Deps = {
  /** 老師自己的 Email（auth.users → profiles fallback）。 */
  teacherEmail: (admin: MinimalAdmin, userId: string) => Promise<string | null>;
  /** 寄信；未設定金鑰回 'skipped'，寄送失敗 throw。 */
  sendEmail: (to: string, subject: string, html: string, text: string) => Promise<'sent' | 'skipped'>;
  /** LINE 推播；未綁定／無通道回 'skipped'，推播失敗 throw。 */
  pushLine: (admin: MinimalAdmin, expertId: string, teacherUserId: string, text: string) => Promise<'sent' | 'skipped'>;
  siteUrl: string;
  now: () => string;
};

const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';

async function defaultTeacherEmail(admin: MinimalAdmin, userId: string): Promise<string | null> {
  try {
    const res = await admin.auth?.admin?.getUserById(userId);
    const email = (res as any)?.data?.user?.email;
    if (typeof email === 'string' && email.includes('@') && !email.endsWith('@line.local')) return email;
  } catch { /* fallthrough */ }
  try {
    const { data } = await admin.from('profiles').select('email').eq('user_id', userId).maybeSingle();
    const email = (data as any)?.email;
    if (typeof email === 'string' && email.includes('@') && !email.endsWith('@line.local')) return email;
  } catch { /* ignore */ }
  return null;
}

async function defaultSendEmail(to: string, subject: string, html: string, text: string): Promise<'sent' | 'skipped'> {
  const r = await sendAppEmail({ to, subject, html, text, label: 'teacher-expiry-reminder' });
  return r.sent ? 'sent' : 'skipped';
}


async function defaultPushLine(
  admin: MinimalAdmin, expertId: string, teacherUserId: string, text: string,
): Promise<'sent' | 'skipped'> {
  const { data: binding } = await admin.from('member_line_bindings')
    .select('line_user_id').eq('user_id', teacherUserId).eq('expert_id', expertId).eq('is_active', true).maybeSingle();
  const lineUserId = (binding as any)?.line_user_id;
  if (!lineUserId) return 'skipped';
  const { data: ch } = await admin.from('expert_line_channels')
    .select('channel_access_token, is_active').eq('expert_id', expertId).maybeSingle();
  const token = (ch as any)?.is_active ? (ch as any)?.channel_access_token : null;
  if (!token) return 'skipped';
  const res = await fetch(LINE_PUSH_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to: lineUserId, messages: [{ type: 'text', text }] }),
  });
  if (!res.ok) throw new Error(`line ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return 'sent';
}

export function defaultDeps(): Deps {
  return {
    teacherEmail: defaultTeacherEmail,
    sendEmail: defaultSendEmail,
    pushLine: defaultPushLine,
    siteUrl: Deno.env.get('SITE_URL') || 'https://legendflow.tw',
    now: () => new Date().toISOString(),
  };
}

async function auditChannel(
  admin: MinimalAdmin,
  batch: ClaimBatch,
  kind: ReminderKind,
  channel: string,
  result: ChannelResult,
) {
  try {
    await admin.from('audit_logs').insert({
      actor_id: batch.expert_user_id,
      action: result.state === 'failed' ? 'subscriber_expiry.channel_failed' : 'subscriber_expiry.channel_sent',
      target_type: 'expert',
      target_id: batch.expert_id,
      detail: {
        channel,
        state: result.state,
        reminder_type: kind,
        local_date: batch.local_date,
        subscription_count: batch.subscription_count,
        ...(result.reason ? { reason: result.reason } : {}),
        ...(result.error ? { error: result.error } : {}),
      },
    });
  } catch { /* 記錄失敗不影響主流程 */ }
}

async function raiseAlert(admin: MinimalAdmin, failedChannels: string[], nowIso: string) {
  if (failedChannels.length === 0) return;
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: existing } = await admin.from('system_alerts')
      .select('id').eq('kind', 'subscriber_expiry_channel_failure').is('resolved_at', null)
      .gte('fired_at', since).limit(1).maybeSingle();
    if ((existing as any)?.id) return;
    await admin.from('system_alerts').insert({
      kind: 'subscriber_expiry_channel_failure',
      level: 'warning',
      title: '訂閱到期提醒通道寄送失敗',
      message: `以下通道連續失敗：${[...new Set(failedChannels)].join('、')}`,
      detail: { channels: failedChannels, at: nowIso },
    });
  } catch { /* 告警失敗不影響主流程 */ }
}

/** 純處理邏輯，抽出方便 Deno 測試（admin 與通道 deps 皆可 mock）。 */
export async function runSubscriberExpiryReminders(
  admin: MinimalAdmin,
  nowIso: string,
  deps: Partial<Deps> = {},
): Promise<RunStats> {
  const d: Deps = { ...defaultDeps(), ...deps };
  const stats: RunStats = {
    processed: 0, created: 0, deduped: 0, skipped: 0, errors: 0, error_samples: [],
    channels: { inapp: 0, email: 0, line: 0, failed: 0 },
  };
  const { data, error } = await admin.rpc('claim_subscriber_expiry_reminders', { _now: nowIso });
  if (error) throw new Error(`claim failed: ${error.message}`);
  const result = (data || {}) as Partial<ClaimResult>;
  stats.processed = Number(result.due_experts || 0);
  stats.deduped = Number(result.deduped || 0);
  const failedChannels: string[] = [];

  for (const batch of result.batches || []) {
    if (!batch.expert_user_id || !Array.isArray(batch.items) || batch.items.length === 0) {
      stats.skipped++;
      await admin.from('subscriber_expiry_reminders').delete().eq('id', batch.ledger_id);
      continue;
    }
    const kind: ReminderKind = batch.reminder_type === 'subscriber_expiry_churn_24h'
      ? 'subscriber_expiry_churn_24h'
      : 'subscriber_expiry_7d';
    const actionUrl = `${d.siteUrl}${adminSignalsUrl(batch.expert_slug)}`;
    const channels: ChannelMap = {};
    const at = d.now();

    // --- 1) 站內通知 ---
    try {
      const row = (isChurnKind(kind) ? buildSubscriberExpiryChurnReminder : buildSubscriberExpiryTeacherReminder)({
        teacherUserId: batch.expert_user_id,
        expertSlug: batch.expert_slug,
        items: batch.items,
      });
      const { data: inserted, error: insertError } = await admin.from('notifications').insert(row).select('id').single();
      if (insertError || !(inserted as any)?.id) throw new Error(insertError?.message || 'no id');
      channels.inapp = { state: 'sent', at };
      stats.channels.inapp++;
      await admin.from('subscriber_expiry_reminders')
        .update({ notification_id: (inserted as any).id }).eq('id', batch.ledger_id);
    } catch (e) {
      channels.inapp = { state: 'failed', at, error: e instanceof Error ? e.message : String(e) };
      stats.errors++;
      stats.error_samples.push(`inapp:${batch.expert_id}:${channels.inapp.error}`);
    }
    await auditChannel(admin, batch, kind, 'inapp', channels.inapp!);

    const mail = buildTeacherEmail({ kind, expertName: batch.expert_name, items: batch.items, actionUrl });

    // --- 2) Email ---
    try {
      const to = await d.teacherEmail(admin, batch.expert_user_id);
      if (!to) {
        channels.email = { state: 'skipped', at, reason: 'no_teacher_email' };
      } else {
        const outcome = await d.sendEmail(to, mail.subject, mail.html, mail.text);
        channels.email = outcome === 'sent'
          ? { state: 'sent', at }
          : { state: 'skipped', at, reason: 'email_not_configured' };
        if (outcome === 'sent') stats.channels.email++;
      }
    } catch (e) {
      channels.email = { state: 'failed', at, error: e instanceof Error ? e.message : String(e) };
      stats.errors++;
      stats.error_samples.push(`email:${batch.expert_id}:${channels.email.error}`);
      failedChannels.push('email');
    }
    await auditChannel(admin, batch, kind, 'email', channels.email!);

    // --- 3) LINE ---
    try {
      const outcome = await d.pushLine(
        admin, batch.expert_id, batch.expert_user_id,
        buildTeacherLineText({ kind, items: batch.items, actionUrl }),
      );
      channels.line = outcome === 'sent' ? { state: 'sent', at } : { state: 'skipped', at, reason: 'no_line_binding' };
      if (outcome === 'sent') stats.channels.line++;
    } catch (e) {
      channels.line = { state: 'failed', at, error: e instanceof Error ? e.message : String(e) };
      stats.errors++;
      stats.error_samples.push(`line:${batch.expert_id}:${channels.line.error}`);
      failedChannels.push('line');
    }
    await auditChannel(admin, batch, kind, 'line', channels.line!);

    if (hasFailure(channels)) stats.channels.failed++;

    if (allFailed(channels)) {
      // 三通道皆失敗 → 釋放 claim，下次 run 重試
      await admin.from('subscriber_expiry_reminders').delete().eq('id', batch.ledger_id);
      continue;
    }

    try {
      await admin.from('subscriber_expiry_reminders').update({ channels }).eq('id', batch.ledger_id);
    } catch (e) {
      stats.error_samples.push(`ledger_channels:${batch.expert_id}:${e instanceof Error ? e.message : String(e)}`);
    }
    stats.created++;
  }

  await raiseAlert(admin, failedChannels, nowIso);
  return stats;
}

const FN = 'subscriber-expiry-teacher-reminder';

Deno.serve(withLogging(FN, async (req, log) => {
  if (req.method === 'OPTIONS') return corsPreflight();
  try { requireCronKey(req); }
  catch (e) {
    const err = e instanceof AuthError ? e : new AuthError(403, 'FORBIDDEN_CRON', 'Invalid cron request');
    return jsonResponse({ error: err.message, code: err.code }, { status: err.status });
  }

  const admin = serviceClient();
  const startedAt = Date.now();
  const nowIso = new Date().toISOString();
  let stats: RunStats | null = null;
  let status: 'ok' | 'error' = 'ok';
  let message: string | undefined;
  try {
    stats = await runSubscriberExpiryReminders(admin as unknown as MinimalAdmin, nowIso);
    if (stats.errors > 0) status = 'error';
  } catch (e) {
    status = 'error';
    message = e instanceof Error ? e.message : String(e);
    log.error('run_failed', { message });
  }

  const detail = { now: nowIso, ...(stats || {}), ...(message ? { message } : {}) };
  await admin.from('system_jobs_log').insert({
    job_name: FN,
    status,
    detail,
    duration_ms: Date.now() - startedAt,
  }).then(({ error }: { error: { message: string } | null }) => {
    if (error) log.warn('system_jobs_log_insert_failed', { message: error.message });
  });

  log.info('done', detail);
  return jsonResponse({ ok: status === 'ok', ...detail }, { status: status === 'ok' ? 200 : 500 });
}));
