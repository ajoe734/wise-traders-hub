// AUTH: user  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// Admin-only Line push: process a job in line_push_jobs (immediate or invoked by cron).
// Body: { job_id: string }
// Auth: requires company_admin (verified via has_role).
import { serviceClient, userClient } from '../_shared/supabaseClients.ts';
import { requireCompanyAdmin, authErrorResponse } from '../_shared/adminGuard.ts';
import { corsHeaders, corsPreflight, jsonResponse, errorResponse } from '../_shared/cors.ts';

const LINE_MULTICAST_URL = 'https://api.line.me/v2/bot/message/multicast';
const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';
const MULTICAST_BATCH = 150; // Line allows up to 500; keep conservative

function buildMessages(job: any): any[] {
  const kind = job.message_kind;
  if (kind === 'text') {
    return [{ type: 'text', text: String(job.text || '').slice(0, 5000) }];
  }
  if (kind === 'image') {
    const url = String(job.image_url || '');
    return [{ type: 'image', originalContentUrl: url, previewImageUrl: url }];
  }
  // text_with_action -> Flex bubble
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
        contents: [
          { type: 'text', text, wrap: true, size: 'md', color: '#1F2937' },
        ],
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

async function processJob(admin: any, jobId: string) {
  // Lock the job: mark processing
  const { data: locked, error: lockErr } = await admin
    .from('line_push_jobs')
    .update({ status: 'processing', started_at: new Date().toISOString() })
    .eq('id', jobId)
    .in('status', ['pending'])
    .select('*')
    .maybeSingle();
  if (lockErr) throw lockErr;
  if (!locked) {
    const { data: existing } = await admin.from('line_push_jobs').select('*').eq('id', jobId).maybeSingle();
    return { ok: false, reason: 'not_pending', job: existing };
  }

  const token = Deno.env.get('PLATFORM_LINE_CHANNEL_TOKEN') || '';
  if (!token) {
    await admin.from('line_push_jobs').update({
      status: 'failed', error: 'PLATFORM_LINE_CHANNEL_TOKEN not set', finished_at: new Date().toISOString(),
    }).eq('id', jobId);
    return { ok: false, reason: 'no_platform_token' };
  }

  // Validate
  const recipients: string[] = locked.recipient_user_ids || [];
  if (!recipients.length) {
    await admin.from('line_push_jobs').update({
      status: 'failed', error: 'no recipients', finished_at: new Date().toISOString(),
    }).eq('id', jobId);
    return { ok: false, reason: 'no_recipients' };
  }
  if (locked.message_kind === 'image' && !locked.image_url) {
    await admin.from('line_push_jobs').update({
      status: 'failed', error: 'image_url required', finished_at: new Date().toISOString(),
    }).eq('id', jobId);
    return { ok: false, reason: 'no_image_url' };
  }
  if ((locked.message_kind === 'text' || locked.message_kind === 'text_with_action') && !locked.text) {
    await admin.from('line_push_jobs').update({
      status: 'failed', error: 'text required', finished_at: new Date().toISOString(),
    }).eq('id', jobId);
    return { ok: false, reason: 'no_text' };
  }

  // Resolve line_user_id for recipients
  const { data: profiles } = await admin
    .from('profiles')
    .select('user_id, line_user_id, display_name')
    .in('user_id', recipients);

  const bound: Array<{ user_id: string; line_user_id: string }> = [];
  const skipped: Array<{ user_id: string; reason: string }> = [];
  for (const uid of recipients) {
    const p = (profiles || []).find((x: any) => x.user_id === uid);
    if (p && p.line_user_id) bound.push({ user_id: uid, line_user_id: p.line_user_id });
    else skipped.push({ user_id: uid, reason: 'no_line_binding' });
  }

  const messages = buildMessages(locked);
  const results: any[] = [];
  let sent = 0;
  let failed = 0;

  // Batch multicast
  for (let i = 0; i < bound.length; i += MULTICAST_BATCH) {
    const batch = bound.slice(i, i + MULTICAST_BATCH);
    const ids = batch.map((b) => b.line_user_id);
    try {
      const r = await fetch(LINE_MULTICAST_URL, {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ to: ids, messages }),
      });
      if (r.ok) {
        sent += batch.length;
        results.push({ batch: i / MULTICAST_BATCH, count: batch.length, ok: true });
      } else {
        const body = (await r.text()).slice(0, 400);
        failed += batch.length;
        results.push({ batch: i / MULTICAST_BATCH, count: batch.length, ok: false, status: r.status, body });
      }
    } catch (e) {
      failed += batch.length;
      results.push({ batch: i / MULTICAST_BATCH, count: batch.length, ok: false, error: String(e).slice(0, 200) });
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

  return { ok: true, status: finalStatus, sent, failed, skipped: skipped.length };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsPreflight();
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const authHeader = req.headers.get('Authorization') || '';

    // AUTH: company_admin (unified contract — see _shared/adminGuard.ts)
    try {
      await requireCompanyAdmin(req);
    } catch (e) {
      return authErrorResponse(e, req);
    }

    const body = await req.json().catch(() => ({}));
    const jobId = String(body.job_id || '');
    if (!jobId) return errorResponse('job_id required', 400);

    const admin = serviceClient();
    const out = await processJob(admin, jobId);
    return jsonResponse(out);
  } catch (e) {
    return errorResponse(String((e as any)?.message || e), 500);
  }
});
