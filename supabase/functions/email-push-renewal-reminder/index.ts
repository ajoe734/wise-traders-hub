// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// W4-1: Email 續訂提醒
// 每日 09:10 (UTC+8)：T-7 / T-3 / T-1 active 訂閱 + T+1 expired 訂閱（24h 內回購保留資料）
// Idempotency: audit_logs action='subscription.renewal_email_sent' + detail.days_left

import { corsHeaders } from '../_shared/cors.ts';
import { renewalUrl } from '../_shared/routes.ts';
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const REMINDER_DAYS = [7, 3, 1, -1] as const;
const RESEND_API_URL = 'https://api.resend.com/emails';

function headerFor(daysLeft: number) {
  if (daysLeft < 0) return '訂閱已過期 — 24h 內回購保留歷史資料';
  if (daysLeft === 0) return '訂閱今日到期';
  if (daysLeft === 1) return '訂閱明日到期';
  return `訂閱剩 ${daysLeft} 天到期`;
}

function buildEmail(opts: {
  expertName: string; planName: string; daysLeft: number;
  expiresAt: string; amount: number; renewUrl: string;
  perfHits: number | null; perfClosed: number | null;
}) {
  const subject = `${opts.daysLeft < 0 ? '🔔' : '⏰'} ${headerFor(opts.daysLeft)}：${opts.expertName} — ${opts.planName}`;
  const expiryDate = new Date(opts.expiresAt).toLocaleDateString('zh-TW', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const perfBlock = (opts.perfHits != null && opts.perfClosed != null && opts.perfClosed > 0)
    ? `<div style="background:#F5F3EF;padding:14px 18px;border-radius:6px;margin:18px 0;">
        <p style="margin:0 0 4px;font-size:13px;color:#666;">過去 30 天該專家績效</p>
        <p style="margin:0;font-size:15px;color:#222;font-weight:600;">
          ${opts.perfClosed} 筆平倉 · 命中 ${opts.perfHits} 筆（命中率 ${Math.round((opts.perfHits / opts.perfClosed) * 100)}%）
        </p>
      </div>` : '';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#F5F3EF;padding:40px 0;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;">
    <h1 style="font-size:20px;color:#222;margin:0 0 16px;">${headerFor(opts.daysLeft)}</h1>
    <p style="font-size:15px;color:#333;line-height:1.6;">
      您訂閱的「<strong>${opts.expertName} — ${opts.planName}</strong>」即將${opts.daysLeft < 0 ? '已' : ''}到期。
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin:14px 0;">
      <tr><td style="padding:6px 0;color:#999;">到期日</td><td style="padding:6px 0;text-align:right;color:#222;">${expiryDate}</td></tr>
      <tr><td style="padding:6px 0;color:#999;">續訂金額</td><td style="padding:6px 0;text-align:right;color:#222;font-weight:600;">NT$ ${opts.amount.toLocaleString()}</td></tr>
    </table>
    ${perfBlock}
    <p style="text-align:center;margin:28px 0;">
      <a href="${opts.renewUrl}" style="display:inline-block;background:#EC662D;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;">立即續訂</a>
    </p>
    <p style="font-size:12px;color:#999;line-height:1.6;margin:18px 0 0;">
      本平台採單次扣款，到期後不會自動扣款。${opts.daysLeft < 0 ? '24h 內回購可保留歷史持倉與訊號訂閱紀錄；超過後資料將自動清理。' : '請於到期前完成續訂，避免服務中斷。'}
    </p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
    <p style="font-size:12px;color:#999;margin:0;">此為系統自動發送，請勿直接回覆。如不再接收續訂提醒，可於帳號設定中關閉。</p>
  </div>
</body></html>`;
  return { subject, html };
}

Deno.serve(withLogging('email-push-renewal-reminder', async (req) => {
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

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY missing' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const siteUrl = (Deno.env.get('SITE_URL') || 'https://legendflow.tw').replace(/\/$/, '');
  const now = new Date();

  const allTargets: Array<{
    sub: any; daysLeft: number; expertId: string; expertName: string; expertSlug: string;
    planId: string; planName: string; amount: number;
  }> = [];

  for (const d of REMINDER_DAYS) {
    const lower = new Date(now.getTime() + d * 24 * 60 * 60 * 1000);
    const upper = new Date(now.getTime() + (d + 1) * 24 * 60 * 60 * 1000);
    const targetStatus = d < 0 ? 'expired' : 'active';

    const { data: subs, error } = await supabaseAdmin
      .from('member_subscriptions')
      .select('id, user_id, plan_id, expires_at, canceled_at, billing_cycle, expert_plans!inner(id, expert_id, name, price_monthly, price_yearly, experts!inner(id, name, slug))')
      .eq('status', targetStatus)
      .is('canceled_at', null)
      .gte('expires_at', lower.toISOString())
      .lt('expires_at', upper.toISOString());

    if (error) { console.error(`window ${d}:`, error.message); continue; }
    for (const sub of subs || []) {
      const plan: any = sub.expert_plans;
      const expert: any = plan.experts;
      const cycle = (sub as any).billing_cycle === 'yearly' ? 'yearly' : 'monthly';
      const amount = cycle === 'yearly'
        ? (plan.price_yearly || (plan.price_monthly || 0) * 12)
        : (plan.price_monthly || 0);
      allTargets.push({
        sub: { ...sub, billing_cycle: cycle }, daysLeft: d,
        expertId: expert.id, expertName: expert.name, expertSlug: expert.slug,
        planId: plan.id, planName: plan.name, amount,
      });
    }
  }

  if (allTargets.length === 0) {
    return new Response(JSON.stringify({ reminded: 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let totalSent = 0;
  const results: any[] = [];
  const tzOffsetMs = 8 * 60 * 60 * 1000;
  const dayStart = new Date(Math.floor((Date.now() + tzOffsetMs) / 86400000) * 86400000 - tzOffsetMs);

  for (const t of allTargets) {
    // 偏好檢查：用戶可關閉續訂 email
    const { data: pref } = await supabaseAdmin
      .from('notification_preferences')
      .select('renewal_email')
      .eq('user_id', t.sub.user_id)
      .maybeSingle();
    if (pref && pref.renewal_email === false) {
      results.push({ sub_id: t.sub.id, days_left: t.daysLeft, status: 'skipped_pref' });
      continue;
    }

    // Email 取得（跳過 line 虛擬）
    const { data: userData } = await supabaseAdmin.auth.admin.getUserById(t.sub.user_id);
    const rawEmail = userData?.user?.email;
    const userEmail = rawEmail && !rawEmail.endsWith('@line.local') ? rawEmail : null;
    if (!userEmail) {
      results.push({ sub_id: t.sub.id, days_left: t.daysLeft, status: 'skipped_no_email' });
      continue;
    }

    // Idempotency：同日同窗口只發一次
    const { data: dupe } = await supabaseAdmin
      .from('audit_logs')
      .select('id')
      .eq('action', 'subscription.renewal_email_sent')
      .eq('target_id', t.sub.id)
      .gte('created_at', dayStart.toISOString())
      .contains('detail', { days_left: t.daysLeft })
      .limit(1)
      .maybeSingle();
    if (dupe) {
      results.push({ sub_id: t.sub.id, days_left: t.daysLeft, status: 'skipped_dedupe' });
      continue;
    }

    // 績效摘要：近 30 天 user_performances（hit = pnl_percent>0；closed = updated_at<now-1d 視為已結算用近似）
    // 此處用簡化：抓該 expert 全部紀錄計命中率
    let perfHits: number | null = null;
    let perfClosed: number | null = null;
    try {
      const { data: perfRows } = await supabaseAdmin
        .from('user_performances')
        .select('pnl_percent')
        .eq('user_id', t.expertId);
      if (perfRows && perfRows.length > 0) {
        perfClosed = perfRows.length;
        perfHits = perfRows.filter((r: any) => Number(r.pnl_percent || 0) > 0).length;
      }
    } catch (e) {
      console.warn('perf_lookup_failed', (e as Error).message);
    }

    const cycle = (t.sub as any).billing_cycle === 'yearly' ? 'yearly' : 'monthly';
    const renewUrl = renewalUrl(t.expertSlug, t.planId, {
      baseUrl: siteUrl,
      query: {
        cycle,
        utm_source: 'email',
        utm_medium: 'renewal',
        utm_campaign: `d${t.daysLeft}`,
      },
    });
    const { subject, html } = buildEmail({
      expertName: t.expertName, planName: t.planName,
      daysLeft: t.daysLeft, expiresAt: t.sub.expires_at, amount: t.amount,
      renewUrl, perfHits, perfClosed,
    });

    const er = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: 'legendflow <noreply@legendflow.tw>',
        to: [userEmail], subject, html,
      }),
    });

    if (er.ok) {
      totalSent++;
      await supabaseAdmin.from('audit_logs').insert({
        actor_id: t.sub.user_id,
        action: 'subscription.renewal_email_sent',
        target_type: 'member_subscription',
        target_id: t.sub.id,
        detail: { days_left: t.daysLeft, expert_id: t.expertId, plan_id: t.planId },
      });
      results.push({ sub_id: t.sub.id, days_left: t.daysLeft, status: 'sent' });
    } else {
      const errBody = await er.text();
      console.error('resend_failed', er.status, errBody);
      results.push({ sub_id: t.sub.id, days_left: t.daysLeft, status: 'failed', error: errBody });
    }
  }

  return new Response(JSON.stringify({
    reminded: totalSent, total_targets: allTargets.length, details: results,
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}));
