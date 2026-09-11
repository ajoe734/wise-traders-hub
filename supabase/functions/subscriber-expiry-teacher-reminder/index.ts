// AUTH: cron
// 訂閱者即將到期 → 老師每日撰寫時間的彙總站內通知。
// 名單 / 時間門 / dedupe 全在 DB RPC `claim_subscriber_expiry_reminders`（一次 query，無 N+1）；
// 本函式只負責：呼叫 claim → 用 notificationTemplates 建 row → 寫 notifications → 回填 ledger。
// 寫入失敗時刪掉 ledger row，讓下一小時重試；同日同老師最多一則。
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { corsPreflight, jsonResponse } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/supabaseClients.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
import { buildSubscriberExpiryTeacherReminder, type SubscriberExpiryItem } from '../_shared/notificationTemplates.ts';

export type ClaimBatch = {
  ledger_id: string;
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
};

type MinimalAdmin = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  from: (table: string) => any;
};

/** 純處理邏輯，抽出方便 Deno 測試（admin 可 mock）。 */
export async function runSubscriberExpiryReminders(admin: MinimalAdmin, nowIso: string): Promise<RunStats> {
  const stats: RunStats = { processed: 0, created: 0, deduped: 0, skipped: 0, errors: 0, error_samples: [] };
  const { data, error } = await admin.rpc('claim_subscriber_expiry_reminders', { _now: nowIso });
  if (error) throw new Error(`claim failed: ${error.message}`);
  const result = (data || {}) as Partial<ClaimResult>;
  stats.processed = Number(result.due_experts || 0);
  stats.deduped = Number(result.deduped || 0);

  for (const batch of result.batches || []) {
    if (!batch.expert_user_id || !Array.isArray(batch.items) || batch.items.length === 0) {
      stats.skipped++;
      await admin.from('subscriber_expiry_reminders').delete().eq('id', batch.ledger_id);
      continue;
    }
    let row;
    try {
      row = buildSubscriberExpiryTeacherReminder({
        teacherUserId: batch.expert_user_id,
        expertSlug: batch.expert_slug,
        items: batch.items,
      });
    } catch (e) {
      stats.errors++;
      stats.error_samples.push(`build:${batch.expert_id}:${e instanceof Error ? e.message : String(e)}`);
      await admin.from('subscriber_expiry_reminders').delete().eq('id', batch.ledger_id);
      continue;
    }
    const { data: inserted, error: insertError } = await admin.from('notifications').insert(row).select('id').single();
    if (insertError || !inserted?.id) {
      stats.errors++;
      stats.error_samples.push(`insert:${batch.expert_id}:${insertError?.message || 'no id'}`);
      // 釋放 claim → 下次 run 重試
      await admin.from('subscriber_expiry_reminders').delete().eq('id', batch.ledger_id);
      continue;
    }
    const { error: linkError } = await admin.from('subscriber_expiry_reminders')
      .update({ notification_id: inserted.id }).eq('id', batch.ledger_id);
    if (linkError) {
      // 通知已存在，ledger 仍在（dedupe 有效），只記錄
      stats.error_samples.push(`ledger_link:${batch.expert_id}:${linkError.message}`);
    }
    stats.created++;
  }
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
