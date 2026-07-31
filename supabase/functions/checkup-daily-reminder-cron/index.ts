// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// 每日 14:00 (UTC+8) cron：找出「有效訂閱 + 有持倉」的用戶，推播「今日可跑收盤分析」
// Line（若 profile.line_user_id 存在）+ 站內通知；Email 視為次要管道（暫不發）
// 用 checkup_daily_reminders UNIQUE(user_id, reminded_on) 防重複。
import { serviceClient } from '../_shared/supabaseClients.ts';
import { corsHeaders, jsonResponse, corsPreflight } from '../_shared/cors.ts';
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
import { buildNotificationRow, checkupUrl } from '../_shared/routes.ts';

const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';
const SITE_URL = 'https://legendflow.tw';

function todayTaipei(): string {
  // YYYY-MM-DD in UTC+8
  const ms = Date.now() + 8 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

const handler = withLogging('checkup-daily-reminder-cron', async (req, log) => {
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

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = serviceClient();

  const today = todayTaipei();
  const nowIso = new Date().toISOString();

  // 1) 找出所有 active 訂閱（expires_at > now）的 user_id
  const { data: subs, error: subErr } = await admin
    .from('checkup_subscriptions')
    .select('user_id, expires_at, status')
    .eq('status', 'active')
    .gt('expires_at', nowIso);
  if (subErr) {
    log.error('subs_query_failed', { msg: subErr.message });
    return jsonResponse({ error: subErr.message }, { status: 500 });
  }
  const userIds = Array.from(new Set((subs || []).map((s: any) => s.user_id)));

  // 2) 過濾出有持倉的 user（checkup_storage 存在且 non-empty holdings）
  const eligible: string[] = [];
  for (const uid of userIds) {
    const { data: storage } = await admin
      .from('checkup_storage')
      .select('payload')
      .eq('user_id', uid)
      .maybeSingle();
    const holdings = storage?.payload?.holdings;
    if (Array.isArray(holdings) && holdings.length > 0) eligible.push(uid);
  }

  // 3) 載入所有啟用 OA（一次撈，重複用）
  const { data: oas } = await admin
    .from('expert_line_channels')
    .select('channel_access_token, channel_name')
    .eq('is_active', true)
    .not('channel_access_token', 'is', null);

  // 4) 對每位 eligible user 嘗試 upsert reminder + push
  const results: any[] = [];
  for (const uid of eligible) {
    // upsert reminder (do nothing if exists)
    const { error: insErr, data: inserted } = await admin
      .from('checkup_daily_reminders')
      .insert({ user_id: uid, reminded_on: today, channels: {} })
      .select('id')
      .maybeSingle();
    if (insErr) {
      if (!/duplicate key/.test(insErr.message)) {
        results.push({ user_id: uid, status: 'insert_failed', err: insErr.message });
      } else {
        results.push({ user_id: uid, status: 'already_reminded' });
      }
      continue;
    }

    // 站內通知
    await admin.from('notifications').insert(buildNotificationRow({
      userId: uid,
      title: '今日可跑收盤分析',
      body: '台股已收盤，點此進入收盤分析，分析會在背景進行，完成後通知您。',
      type: 'info',
      link: checkupUrl({ autorun: true }),
    }));

    // Line（若有 line_user_id）
    const { data: profile } = await admin
      .from('profiles').select('line_user_id').eq('user_id', uid).maybeSingle();
    const lineId = profile?.line_user_id || null;
    let linePushed = false;
    if (lineId && oas && oas.length > 0) {
      const text = `📊 今日台股已收盤\n\n你的收盤分析可以開始了。\n點下方連結進入後，系統會自動載入你的持倉並開始分析，可關閉網頁，完成後再通知你。\n\n${SITE_URL}/holding-checkup?autorun=1`;
      for (const oa of oas) {
        try {
          const r = await fetch(LINE_PUSH_URL, {
            method: 'POST',
            signal: AbortSignal.timeout(10000),
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${oa.channel_access_token}` },
            body: JSON.stringify({ to: lineId, messages: [{ type: 'text', text }] }),
          });
          if (r.ok) { linePushed = true; break; }
        } catch (_e) { /* try next */ }
      }
    }

    // 紀錄通道
    await admin.from('checkup_daily_reminders')
      .update({ channels: { in_app: true, line: linePushed } })
      .eq('id', inserted!.id);

    results.push({ user_id: uid, status: 'reminded', line: linePushed });
  }

  log.info('reminder_done', { eligible: eligible.length, results: results.length });
  return jsonResponse({ date: today, eligible: eligible.length, results });
});

Deno.serve(handler);
