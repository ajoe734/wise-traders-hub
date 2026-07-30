// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// 收盤分析完成 → 同時推 Line / Email / 站內通知
// Input: { job_id: string }
// 由前端在 useDailyAnalysisWorkflow 完成時呼叫；也可由背景 worker 呼叫。
import { serviceClient } from '../_shared/supabaseClients.ts';
import { corsHeaders, jsonResponse, corsPreflight } from '../_shared/cors.ts';
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { withLogging } from '../_shared/edgeLogger.ts';

const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';
const RESEND_API_URL = 'https://api.resend.com/emails';
const SITE_URL = 'https://legendflow.tw';

interface JobSummary {
  total_pnl?: number;
  watchlist?: Array<{ code: string; name: string; note: string }>;
  total_holdings?: number;
}

function buildLineMessage(summary: JobSummary, deepLink: string) {
  const pnl = summary.total_pnl ?? 0;
  const pnlStr = (pnl >= 0 ? '+' : '') + Math.round(pnl).toLocaleString();
  const watchLines = (summary.watchlist || []).slice(0, 3).map((w) => `• ${w.name}(${w.code})：${w.note}`).join('\n');
  const text = [
    '📊 收盤分析已完成',
    '',
    `今日損益：NT$ ${pnlStr}`,
    `分析持股：${summary.total_holdings ?? 0} 檔`,
    watchLines ? '\n需注意：' : '',
    watchLines,
    '',
    `查看完整分析：${deepLink}`,
  ].filter(Boolean).join('\n');
  return { type: 'text', text };
}

function buildEmail(summary: JobSummary, deepLink: string, displayName: string) {
  const pnl = summary.total_pnl ?? 0;
  const pnlColor = pnl >= 0 ? '#DC3545' : '#28a745'; // 台股慣例：紅漲綠跌
  const pnlStr = (pnl >= 0 ? '+' : '') + Math.round(pnl).toLocaleString();
  const watchRows = (summary.watchlist || []).slice(0, 3)
    .map((w) => `<tr><td style="padding:6px 0;color:#222;">${w.name}(${w.code})</td><td style="padding:6px 0;text-align:right;color:#666;font-size:13px;">${w.note}</td></tr>`)
    .join('');
  const subject = `📊 收盤分析已完成 — 今日損益 NT$ ${pnlStr}`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#F5F3EF;padding:40px 0;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;">
    <h1 style="font-size:20px;color:#222;margin:0 0 16px;">收盤分析已完成</h1>
    <p style="font-size:15px;color:#333;line-height:1.6;">${displayName || '您好'}，今日的收盤分析已準備好。</p>
    <div style="background:#F5F3EF;padding:14px 18px;border-radius:6px;margin:18px 0;">
      <p style="margin:0 0 4px;font-size:13px;color:#666;">今日損益</p>
      <p style="margin:0;font-size:22px;font-weight:600;color:${pnlColor};">NT$ ${pnlStr}</p>
      <p style="margin:8px 0 0;font-size:12px;color:#999;">分析持股 ${summary.total_holdings ?? 0} 檔</p>
    </div>
    ${watchRows ? `<p style="font-size:13px;color:#666;margin:18px 0 6px;">需注意個股</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">${watchRows}</table>` : ''}
    <p style="text-align:center;margin:28px 0;">
      <a href="${deepLink}" style="display:inline-block;background:#EC662D;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;">查看完整分析</a>
    </p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
    <p style="font-size:12px;color:#999;margin:0;">此為系統自動發送，請勿直接回覆。</p>
  </div>
</body></html>`;
  return { subject, html };
}

const handler = withLogging('checkup-notify-complete', async (req, log) => {
  // AUTH: cron (Phase M-2 runtime enforcement)
  if (req.method !== 'OPTIONS') {
    try { requireCronKey(req); }
    catch (e) {
      if (e instanceof AuthError) {
        return new Response(JSON.stringify({ error: e.message, code: e.code }), {
          status: e.status,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      throw e;
    }
  }

  if (req.method === 'OPTIONS') return corsPreflight();
  if (req.method !== 'POST') return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, { status: 405 });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

  // Auth: 接受使用者 JWT（前端呼叫）或 service_role
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return jsonResponse({ error: 'AUTH_REQUIRED' }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const jobId = String(body?.job_id || '').trim();
  if (!jobId) return jsonResponse({ error: 'job_id is required' }, { status: 400 });

  const admin = serviceClient();

  // 取得 job + 驗使用者
  const { data: job, error: jobErr } = await admin
    .from('checkup_analysis_jobs').select('*').eq('id', jobId).maybeSingle();
  if (jobErr || !job) {
    log.error('job_not_found', { jobId, err: jobErr?.message });
    return jsonResponse({ error: 'JOB_NOT_FOUND' }, { status: 404 });
  }

  // 若是使用者 JWT，需與 job.user_id 相符
  if (token !== SERVICE_ROLE_KEY) {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SERVICE_ROLE_KEY },
    });
    if (!userRes.ok) return jsonResponse({ error: 'AUTH_INVALID' }, { status: 401 });
    const u = await userRes.json();
    if (u?.id !== job.user_id) return jsonResponse({ error: 'FORBIDDEN' }, { status: 403 });
  }

  if (job.notified_at) {
    return jsonResponse({ ok: true, skipped: 'already_notified' });
  }

  const summary: JobSummary = job.result_summary || {};
  const deepLink = `${SITE_URL}/holding-checkup?job=${job.id}`;

  // 撈 profile + email + 通知偏好
  const [{ data: profile }, { data: userInfo }, { data: prefs }] = await Promise.all([
    admin.from('profiles').select('display_name, line_user_id').eq('user_id', job.user_id).maybeSingle(),
    admin.auth.admin.getUserById(job.user_id),
    admin.from('notification_preferences').select('checkup_complete_line, checkup_complete_email').eq('user_id', job.user_id).maybeSingle(),
  ]);
  const userEmail = userInfo?.user?.email || '';
  const isLineVirtual = /^line_.+@line\.local$/.test(userEmail);
  const displayName = profile?.display_name || '';
  const lineEnabled = prefs?.checkup_complete_line !== false;
  const emailEnabled = prefs?.checkup_complete_email !== false;

  const channels: Record<string, any> = {};

  // 1) 站內通知（必發，不受偏好控制）
  try {
    const pnl = summary.total_pnl ?? 0;
    const pnlStr = (pnl >= 0 ? '+' : '') + Math.round(pnl).toLocaleString();
    const noteTitle = job.status === 'failed' ? '收盤分析失敗' : '收盤分析已完成';
    const noteBody = job.status === 'failed'
      ? (job.error_text || '分析失敗，請重新嘗試。')
      : `今日損益 NT$ ${pnlStr}，分析 ${summary.total_holdings ?? 0} 檔持股。`;
    const { data: note } = await admin.from('notifications').insert({
      user_id: job.user_id,
      title: noteTitle,
      body: noteBody,
      type: job.status === 'failed' ? 'warning' : 'info',
      link: `/holding-checkup?job=${job.id}`,
    }).select('id').maybeSingle();
    channels.in_app = { ok: true, notification_id: note?.id || null };
  } catch (e) {
    channels.in_app = { ok: false, error: String(e).slice(0, 200) };
  }

  // 2) Line push（優先用平台 OA，fallback 到任一啟用的 expert OA）
  const lineId = profile?.line_user_id || null;
  const platformLineToken = Deno.env.get('PLATFORM_LINE_CHANNEL_TOKEN') || '';
  if (!lineEnabled) {
    channels.line = { ok: false, reason: 'user_opt_out' };
  } else if (lineId && job.status === 'done') {
    try {
      const tokens: Array<{ token: string; name: string }> = [];
      if (platformLineToken) tokens.push({ token: platformLineToken, name: 'platform' });
      const { data: oas } = await admin
        .from('expert_line_channels')
        .select('channel_access_token, channel_name')
        .eq('is_active', true)
        .not('channel_access_token', 'is', null);
      for (const oa of oas || []) {
        if (oa.channel_access_token) tokens.push({ token: oa.channel_access_token, name: oa.channel_name });
      }
      const msg = buildLineMessage(summary, deepLink);
      let pushed = false;
      const errs: any[] = [];
      for (const t of tokens) {
        try {
          const r = await fetch(LINE_PUSH_URL, {
            method: 'POST',
            signal: AbortSignal.timeout(10000),
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t.token}` },
            body: JSON.stringify({ to: lineId, messages: [msg] }),
          });
          if (r.ok) { pushed = true; channels.line = { ok: true, via: t.name }; break; }
          errs.push({ via: t.name, status: r.status, body: (await r.text()).slice(0, 200) });
        } catch (e) { errs.push({ via: t.name, err: String(e).slice(0, 200) }); }
      }
      if (!pushed) channels.line = { ok: false, errs };
    } catch (e) {
      channels.line = { ok: false, error: String(e).slice(0, 200) };
    }
  } else {
    channels.line = { ok: false, reason: lineId ? 'job_not_done' : 'no_line_binding' };
  }

  // 3) Email（若有真實 email 且 Resend 已設定且使用者未關閉）
  if (!emailEnabled) {
    channels.email = { ok: false, reason: 'user_opt_out' };
  } else if (RESEND_API_KEY && userEmail && !isLineVirtual && job.status === 'done') {
    try {
      const { subject, html } = buildEmail(summary, deepLink, displayName);
      const r = await fetch(RESEND_API_URL, {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify({ from: 'legendflow <noreply@legendflow.tw>', to: [userEmail], subject, html }),
      });
      if (r.ok) channels.email = { ok: true };
      else channels.email = { ok: false, status: r.status, body: (await r.text()).slice(0, 200) };
    } catch (e) {
      channels.email = { ok: false, error: String(e).slice(0, 200) };
    }
  } else {
    channels.email = { ok: false, reason: !RESEND_API_KEY ? 'no_resend' : (isLineVirtual ? 'line_virtual_email' : (!userEmail ? 'no_email' : 'job_not_done')) };
  }

  // 標記已通知
  await admin.from('checkup_analysis_jobs')
    .update({ notified_at: new Date().toISOString() })
    .eq('id', jobId);

  return jsonResponse({ ok: true, job_id: jobId, channels });
});

Deno.serve(handler);
