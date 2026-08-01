// AUTH: cron
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { corsPreflight, jsonResponse } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/supabaseClients.ts';
import { buildPendingJournalPublishReminder } from '../_shared/notificationTemplates.ts';
import { taipeiMondayOf, taipeiWeekRangeUtc } from '../_shared/weekBoundary.ts';

type Expert = { id: string; user_id: string | null; name: string | null; slug: string | null };

/** 週一 08:00 前仍屬前一個週記週期；其他時間使用當週。 */
export function reminderWeekStart(now: Date): string {
  const taipei = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const isMondayBeforeOpen = taipei.getUTCDay() === 1 && taipei.getUTCHours() < 8;
  return taipeiMondayOf(isMondayBeforeOpen ? new Date(now.getTime() - 24 * 60 * 60 * 1000) : now);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsPreflight();
  try { requireCronKey(req); }
  catch (e) {
    const err = e instanceof AuthError ? e : new AuthError(403, 'FORBIDDEN_CRON', 'Invalid cron request');
    return jsonResponse({ error: err.message, code: err.code }, { status: err.status });
  }

  const admin = serviceClient();
  const now = new Date();
  const weekStart = reminderWeekStart(now);
  const { startIso, endIso } = taipeiWeekRangeUtc(weekStart);
  const { data: pending, error } = await admin.from('expert_signals')
    .select('id, expert_id, created_at')
    .eq('status', 'pending')
    .gte('created_at', startIso)
    .lt('created_at', endIso);
  if (error) return jsonResponse({ error: error.message }, { status: 500 });

  const counts = new Map<string, number>();
  for (const row of pending || []) counts.set(row.expert_id, (counts.get(row.expert_id) || 0) + 1);
  if (counts.size === 0) return jsonResponse({ ok: true, week_start: weekStart, notified: 0 });

  const { data: experts, error: expertsError } = await admin.from('experts')
    .select('id, user_id, name, slug').in('id', Array.from(counts.keys())).eq('role', 'mentor');
  if (expertsError) return jsonResponse({ error: expertsError.message }, { status: 500 });

  let notified = 0;
  for (const expert of (experts || []) as Expert[]) {
    if (!expert.user_id) continue;
    const dedupeSince = startIso;
    const { count } = await admin.from('notifications').select('id', { count: 'exact', head: true })
      .eq('user_id', expert.user_id).eq('type', 'journal_publish_reminder').gte('created_at', dedupeSince);
    if ((count || 0) > 0) continue;
    const row = buildPendingJournalPublishReminder({
      mentorUserId: expert.user_id,
      expertName: expert.name,
      expertSlug: expert.slug,
      signalCount: counts.get(expert.id) || 0,
    });
    const { error: insertError } = await admin.from('notifications').insert(row);
    if (!insertError) notified++;
  }

  return jsonResponse({ ok: true, week_start: weekStart, pending_experts: counts.size, notified });
});