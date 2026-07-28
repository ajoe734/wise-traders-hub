// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// Cron: scan line_push_jobs for pending+scheduled and process them.
// Invoked by pg_cron every minute. No auth (relies on service role + scheduled URL).
import { corsPreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const LINE_MULTICAST_URL = 'https://api.line.me/v2/bot/message/multicast';
const MULTICAST_BATCH = 150;

function buildMessages(job: any): any[] {
  const kind = job.message_kind;
  if (kind === 'text') return [{ type: 'text', text: String(job.text || '').slice(0, 5000) }];
  if (kind === 'image') {
    const url = String(job.image_url || '');
    return [{ type: 'image', originalContentUrl: url, previewImageUrl: url }];
  }
  const text = String(job.text || '').slice(0, 2000);
  const label = String(job.action_label || '查看').slice(0, 20);
  const uri = String(job.action_url || '');
  return [{
    type: 'flex',
    altText: text.slice(0, 400) || 'legendflow 通知',
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', spacing: 'md',
        contents: [{ type: 'text', text, wrap: true, size: 'md', color: '#1F2937' }],
      },
      footer: uri ? {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [{
          type: 'button', style: 'primary', color: '#EC662D',
          action: { type: 'uri', label, uri },
        }],
      } : undefined,
    },
  }];
}

async function processOne(admin: any, jobId: string, token: string) {
  const { data: locked } = await admin
    .from('line_push_jobs')
    .update({ status: 'processing', started_at: new Date().toISOString() })
    .eq('id', jobId).eq('status', 'pending')
    .select('*').maybeSingle();
  if (!locked) return { jobId, ok: false, reason: 'already_processed' };

  const recipients: string[] = locked.recipient_user_ids || [];
  if (!recipients.length) {
    await admin.from('line_push_jobs').update({
      status: 'failed', error: 'no recipients', finished_at: new Date().toISOString(),
    }).eq('id', jobId);
    return { jobId, ok: false, reason: 'no_recipients' };
  }

  const { data: profiles } = await admin
    .from('profiles')
    .select('user_id, line_user_id')
    .in('user_id', recipients);
  const bound: string[] = [];
  const skipped: any[] = [];
  for (const uid of recipients) {
    const p = (profiles || []).find((x: any) => x.user_id === uid);
    if (p?.line_user_id) bound.push(p.line_user_id);
    else skipped.push({ user_id: uid, reason: 'no_line_binding' });
  }

  const messages = buildMessages(locked);
  const results: any[] = [];
  let sent = 0, failed = 0;
  for (let i = 0; i < bound.length; i += MULTICAST_BATCH) {
    const batch = bound.slice(i, i + MULTICAST_BATCH);
    try {
      const r = await fetch(LINE_MULTICAST_URL, {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ to: batch, messages }),
      });
      if (r.ok) { sent += batch.length; results.push({ count: batch.length, ok: true }); }
      else {
        const body = (await r.text()).slice(0, 400);
        failed += batch.length;
        results.push({ count: batch.length, ok: false, status: r.status, body });
      }
    } catch (e) {
      failed += batch.length;
      results.push({ count: batch.length, ok: false, error: String(e).slice(0, 200) });
    }
  }

  const finalStatus = failed === 0 && sent > 0 ? 'sent' : (sent > 0 ? 'partial' : 'failed');
  await admin.from('line_push_jobs').update({
    status: finalStatus,
    sent_count: sent,
    skipped_count: skipped.length,
    failed_count: failed,
    result: { batches: results, skipped },
    finished_at: new Date().toISOString(),
  }).eq('id', jobId);
  return { jobId, ok: true, status: finalStatus, sent, failed };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsPreflight();
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const token = Deno.env.get('PLATFORM_LINE_CHANNEL_TOKEN') || '';
    if (!token) return errorResponse('PLATFORM_LINE_CHANNEL_TOKEN not set', 500);
    const admin = createClient(supabaseUrl, serviceKey);
    const nowIso = new Date().toISOString();
    const { data: due } = await admin
      .from('line_push_jobs')
      .select('id')
      .eq('status', 'pending')
      .or(`scheduled_at.is.null,scheduled_at.lte.${nowIso}`)
      .order('scheduled_at', { ascending: true, nullsFirst: true })
      .limit(20);
    const processed: any[] = [];
    for (const row of due || []) {
      processed.push(await processOne(admin, row.id, token));
    }
    return jsonResponse({ ok: true, processed_count: processed.length, processed });
  } catch (e) {
    return errorResponse(String((e as any)?.message || e), 500);
  }
});
