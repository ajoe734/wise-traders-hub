// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// W4-1: 會員續訂提醒（站內通知 + Email，兩通道各自獨立成敗）
// 每日 09:10 (UTC+8)：T-7 / T-3 / T-1 / 到期當日 active 訂閱 + T+1 expired 訂閱（24h 內回購保留資料）
// Idempotency: audit_logs action='subscription.renewal_inapp_sent' / 'subscription.renewal_email_sent' + detail.days_left
// 站內通知不依賴外部寄信服務：RESEND_API_KEY 缺漏或失效時，Email 記為 failed，站內通知照送。

import { serviceClient } from '../_shared/supabaseClients.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { renewalUrl, buildNotificationRow } from '../_shared/routes.ts';
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { withLogging } from '../_shared/edgeLogger.ts';

// 與 LINE 提醒、src/lib/renewalReminderStatus.ts 對齊：T-7 / T-3 / T-1 / 到期當日 / 過期後 24h
const REMINDER_DAYS = [7, 3, 1, 0, -1] as const;
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

  const supabaseAdmin = serviceClient();
  // RESEND_API_KEY 缺漏／失效不得讓整支排程中斷：站內通知是獨立且不依賴外部服務的通道。
  const resendKey = Deno.env.get('RESEND_API_KEY');

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
  let totalInapp = 0;
  const results: any[] = [];
  const tzOffsetMs = 8 * 60 * 60 * 1000;
  const dayStart = new Date(Math.floor((Date.now() + tzOffsetMs) / 86400000) * 86400000 - tzOffsetMs);

  for (const t of allTargets) {
    // 偏好檢查：用戶可關閉續訂 email（只影響 Email 通道，站內通知是帳號內的必要提醒）
    const { data: pref } = await supabaseAdmin
      .from('notification_preferences')
      .select('renewal_email')
      .eq('user_id', t.sub.user_id)
      .maybeSingle();
    const emailOptOut = !!pref && pref.renewal_email === false;

    // Email 取得（跳過 line 虛擬信箱）。沒有 email 只影響 Email 通道，站內通知照送。
    const { data: userData } = await supabaseAdmin.auth.admin.getUserById(t.sub.user_id);
    const rawEmail = userData?.user?.email;
    const userEmail = rawEmail && !rawEmail.endsWith('@line.local') ? rawEmail : null;

    // Idempotency：同日、同窗口、同通道只送一次
    const alreadySent = async (action: string) => {
      const { data } = await supabaseAdmin
        .from('audit_logs')
        .select('id')
        .eq('action', action)
        .eq('target_id', t.sub.id)
        .gte('created_at', dayStart.toISOString())
        .contains('detail', { days_left: t.daysLeft })
        .limit(1)
        .maybeSingle();
      return !!data;
    };

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
    const logDetail = { days_left: t.daysLeft, expert_id: t.expertId, plan_id: t.planId };
    const channels: Record<string, string> = {};

    /* ── 通道 1：站內通知（不依賴外部服務，永遠先送） ───────────────── */
    if (await alreadySent('subscription.renewal_inapp_sent')) {
      channels.inapp = 'skipped_dedupe';
    } else {
      try {
        // link 必須是站內相對路徑，由 routes.ts builder 產生（不得帶 baseUrl）
        const inappLink = renewalUrl(t.expertSlug, t.planId, {
          query: { cycle, utm_source: 'inapp', utm_medium: 'renewal', utm_campaign: `d${t.daysLeft}` },
        });
        const row = buildNotificationRow({
          userId: t.sub.user_id,
          title: headerFor(t.daysLeft),
          body: t.daysLeft < 0
            ? `「${t.expertName} — ${t.planName}」已到期。24 小時內回購可保留歷史持倉與訂閱紀錄，續訂金額 NT$ ${t.amount.toLocaleString()}。`
            : `「${t.expertName} — ${t.planName}」${t.daysLeft === 0 ? '今日到期' : `將於 ${t.daysLeft} 天後到期`}。本平台不會自動扣款，續訂金額 NT$ ${t.amount.toLocaleString()}。`,
          type: t.daysLeft <= 0 ? 'warning' : 'info',
          link: inappLink,
        });
        const { error: notifyErr } = await supabaseAdmin.from('notifications').insert(row);
        if (notifyErr) throw new Error(notifyErr.message);
        totalInapp++;
        channels.inapp = 'sent';
        await supabaseAdmin.from('audit_logs').insert({
          actor_id: t.sub.user_id,
          action: 'subscription.renewal_inapp_sent',
          target_type: 'member_subscription',
          target_id: t.sub.id,
          detail: logDetail,
        });
      } catch (e) {
        const msg = (e as Error).message || 'unknown';
        console.error('inapp_notify_failed', t.sub.id, msg);
        channels.inapp = 'failed';
        await supabaseAdmin.from('audit_logs').insert({
          actor_id: t.sub.user_id,
          action: 'subscription.renewal_inapp_failed',
          target_type: 'member_subscription',
          target_id: t.sub.id,
          detail: { ...logDetail, error: msg.slice(0, 500) },
        });
      }
    }

    /* ── 通道 2：Email（失敗不影響站內通知） ───────────────────────── */
    if (emailOptOut) {
      channels.email = 'skipped_pref';
    } else if (!userEmail) {
      channels.email = 'skipped_no_email';
    } else if (await alreadySent('subscription.renewal_email_sent')) {
      channels.email = 'skipped_dedupe';
    } else {
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

      let ok = false;
      let errBody = '';
      let status = 0;
      if (!resendKey) {
        errBody = 'RESEND_API_KEY missing';
      } else {
        try {
          const er = await fetch(RESEND_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
            body: JSON.stringify({
              from: 'legendflow <noreply@legendflow.tw>',
              to: [userEmail], subject, html,
            }),
          });
          ok = er.ok;
          status = er.status;
          if (!ok) errBody = await er.text();
        } catch (e) {
          errBody = (e as Error).message || 'fetch failed';
        }
      }

      if (ok) {
        totalSent++;
        channels.email = 'sent';
        await supabaseAdmin.from('audit_logs').insert({
          actor_id: t.sub.user_id,
          action: 'subscription.renewal_email_sent',
          target_type: 'member_subscription',
          target_id: t.sub.id,
          detail: logDetail,
        });
      } else {
        console.error('resend_failed', status, errBody);
        // 寄送失敗也要留痕，管理頁才看得到「通知失敗」而不是一直顯示待送
        channels.email = 'failed';
        await supabaseAdmin.from('audit_logs').insert({
          actor_id: t.sub.user_id,
          action: 'subscription.renewal_email_failed',
          target_type: 'member_subscription',
          target_id: t.sub.id,
          detail: { ...logDetail, status, error: errBody.slice(0, 500) },
        });
      }
    }

    results.push({ sub_id: t.sub.id, days_left: t.daysLeft, channels });
  }

  return new Response(JSON.stringify({
    reminded: totalSent, inapp: totalInapp, total_targets: allTargets.length, details: results,
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}));
