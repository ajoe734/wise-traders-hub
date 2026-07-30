// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// W4-2: 棄單回收
// 每 30 分鐘執行：掃 payment_intents pending 且 created_at 落在 [now-2h, now-30min]，
// 透過 LINE（有綁定）或 Email（無綁定但有可寄信信箱）一次性提醒繼續付款。
// Idempotency: payment_intents.recovery_notified_at IS NULL，發送後寫入時間戳。

import { serviceClient } from '../_shared/supabaseClients.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { checkupRenewalUrl, renewalUrl } from '../_shared/routes.ts';
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { withLogging } from '../_shared/edgeLogger.ts';

const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';
const RESEND_API_URL = 'https://api.resend.com/emails';

function buildLineFlex(productName: string, amount: number, resumeUrl: string) {
  return {
    type: 'flex',
    altText: `您的訂單還沒完成 — ${productName}（NT$${amount.toLocaleString()}）`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: '#FFF3CD', paddingAll: 'lg',
        contents: [{ type: 'text', text: '🛒 您的訂單還沒完成', weight: 'bold', size: 'lg', color: '#856404' }],
      },
      body: {
        type: 'box', layout: 'vertical',
        contents: [
          { type: 'text', text: productName, weight: 'bold', size: 'lg', color: '#333333', wrap: true },
          { type: 'separator', margin: 'lg' },
          {
            type: 'box', layout: 'horizontal', margin: 'lg',
            contents: [
              { type: 'text', text: '金額', size: 'sm', color: '#999999', flex: 1 },
              { type: 'text', text: `NT$${amount.toLocaleString()}`, size: 'sm', color: '#333333', weight: 'bold', align: 'end', flex: 2 },
            ],
          },
          {
            type: 'text',
            text: '您先前選擇了方案但尚未完成付款。點擊下方按鈕繼續完成訂單，即可立即啟用服務。',
            size: 'xs', color: '#666666', margin: 'lg', wrap: true,
          },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: 'lg',
        contents: [{
          type: 'button', style: 'primary', height: 'sm', color: '#EC662D',
          action: { type: 'uri', label: '繼續完成付款', uri: resumeUrl },
        }],
      },
    },
  };
}

function buildAbandonedEmail(productName: string, amount: number, resumeUrl: string) {
  const subject = `🛒 您的訂單還沒完成 — ${productName}`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#F5F3EF;padding:40px 0;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;">
    <h1 style="font-size:20px;color:#222;margin:0 0 16px;">您的訂單還沒完成</h1>
    <p style="font-size:15px;color:#333;line-height:1.6;">
      您先前選擇了「<strong>${productName}</strong>」方案但尚未完成付款。<br>
      點擊下方按鈕即可繼續完成訂單。
    </p>
    <div style="background:#FFF8E8;border-left:4px solid #EC662D;padding:12px 16px;margin:20px 0;border-radius:4px;">
      <p style="margin:0;font-size:14px;color:#333;">金額：<strong>NT$ ${amount.toLocaleString()}</strong></p>
    </div>
    <p style="text-align:center;margin:28px 0;">
      <a href="${resumeUrl}" style="display:inline-block;background:#EC662D;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;">繼續完成付款</a>
    </p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
    <p style="font-size:12px;color:#999;margin:0;若您已完成付款，請忽略此通知。<br>此為系統自動發送，請勿直接回覆。</p>
  </div>
</body></html>`;
  return { subject, html };
}

Deno.serve(withLogging('recover-abandoned-checkout', async (req) => {
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
  const siteUrl = (Deno.env.get('SITE_URL') || 'https://legendflow.tw').replace(/\/$/, '');
  const resendKey = Deno.env.get('RESEND_API_KEY');

  const now = new Date();
  const upper = new Date(now.getTime() - 30 * 60 * 1000);
  const lower = new Date(now.getTime() - 2 * 60 * 60 * 1000);

  const { data: intents, error: qErr } = await supabaseAdmin
    .from('payment_intents')
    .select('id, trade_no, user_id, product_kind, plan_id, checkup_plan_id, expert_id, amount, billing_cycle, created_at')
    .eq('status', 'pending')
    .is('recovery_notified_at', null)
    .gte('created_at', lower.toISOString())
    .lt('created_at', upper.toISOString())
    .not('user_id', 'is', null);

  if (qErr) {
    console.error('query_failed', qErr);
    return new Response(JSON.stringify({ error: qErr.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // 手動 lookup（payment_intents 沒有 FK，PostgREST 無法 embed）
  const expertPlanIds = Array.from(new Set((intents || []).filter(i => i.product_kind === 'expert_plan' && i.plan_id).map(i => i.plan_id)));
  const checkupPlanIds = Array.from(new Set((intents || []).filter(i => i.product_kind === 'checkup' && i.checkup_plan_id).map(i => i.checkup_plan_id)));

  const [expertPlansRes, checkupPlansRes] = await Promise.all([
    expertPlanIds.length
      ? supabaseAdmin.from('expert_plans').select('id, name, expert_id, experts:expert_id(name, slug)').in('id', expertPlanIds)
      : Promise.resolve({ data: [] as any[] }),
    checkupPlanIds.length
      ? supabaseAdmin.from('checkup_plans').select('id, name').in('id', checkupPlanIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const expertPlanMap = new Map<string, any>((expertPlansRes.data || []).map((p: any) => [p.id, p]));
  const checkupPlanMap = new Map<string, any>((checkupPlansRes.data || []).map((p: any) => [p.id, p]));

  const results: any[] = [];
  let lineCount = 0, emailCount = 0, skipCount = 0;

  for (const intent of intents || []) {
    const i: any = intent;
    let productName = '訂閱方案';
    let resumeUrl = `${siteUrl}/account?utm_source=recovery&utm_campaign=abandoned`;

    if (i.product_kind === 'expert_plan') {
      const plan = expertPlanMap.get(i.plan_id);
      const expert = plan?.experts;
      if (plan && expert?.slug) {
        productName = `${expert?.name || ''} — ${plan?.name || ''}`;
        resumeUrl = renewalUrl(expert.slug, i.plan_id, {
          baseUrl: siteUrl,
          query: { cycle: i.billing_cycle, utm_source: 'recovery', utm_campaign: 'abandoned' },
        });
      }
    } else if (i.product_kind === 'checkup') {
      const plan = checkupPlanMap.get(i.checkup_plan_id);
      if (plan) {
        productName = `健檢 — ${plan?.name || ''}`;
        resumeUrl = checkupRenewalUrl(i.checkup_plan_id, {
          baseUrl: siteUrl,
          query: { cycle: i.billing_cycle, utm_source: 'recovery', utm_campaign: 'abandoned' },
        });
      }
    }


    // 1. 先試 LINE（限 expert_plan 且該專家有綁定）
    let pushedVia: 'line' | 'email' | 'none' = 'none';

    if (i.expert_id && i.product_kind === 'expert_plan') {
      const { data: binding } = await supabaseAdmin
        .from('member_line_bindings')
        .select('line_user_id')
        .eq('user_id', i.user_id)
        .eq('expert_id', i.expert_id)
        .eq('is_active', true)
        .maybeSingle();

      if (binding?.line_user_id) {
        const { data: channel } = await supabaseAdmin
          .from('expert_line_channels')
          .select('channel_access_token, is_active')
          .eq('expert_id', i.expert_id)
          .maybeSingle();
        const token = channel?.is_active ? channel?.channel_access_token : null;
        if (token) {
          const flex = buildLineFlex(productName, i.amount, resumeUrl);
          const res = await fetch(LINE_PUSH_URL, {
            signal: AbortSignal.timeout(10000),
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ to: binding.line_user_id, messages: [flex] }),
          });
          if (res.ok) {
            pushedVia = 'line';
            lineCount++;
          } else {
            console.error('line_push_failed', res.status, await res.text());
          }
        }
      }
    }

    // 2. 沒推到 LINE → 試 Email
    if (pushedVia === 'none' && resendKey) {
      const { data: userData } = await supabaseAdmin.auth.admin.getUserById(i.user_id);
      const rawEmail = userData?.user?.email;
      const userEmail = rawEmail && !rawEmail.endsWith('@line.local') ? rawEmail : null;
      if (userEmail) {
        const { subject, html } = buildAbandonedEmail(productName, i.amount, resumeUrl);
        const er = await fetch(RESEND_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
          body: JSON.stringify({ from: 'legendflow <noreply@legendflow.tw>', to: [userEmail], subject, html }),
        });
        if (er.ok) {
          pushedVia = 'email';
          emailCount++;
        } else {
          console.error('resend_failed', er.status, await er.text());
        }
      }
    }

    if (pushedVia === 'none') skipCount++;

    // 標記為已通知，無論成功或無法推送（避免無限重試）
    await supabaseAdmin
      .from('payment_intents')
      .update({ recovery_notified_at: now.toISOString() })
      .eq('id', i.id);

    // audit log
    await supabaseAdmin.from('audit_logs').insert({
      actor_id: i.user_id,
      action: 'payment.abandoned_recovery_sent',
      target_type: 'payment_intent',
      target_id: i.id,
      detail: { via: pushedVia, product_kind: i.product_kind, amount: i.amount },
    });

    results.push({ intent_id: i.id, via: pushedVia });
  }

  return new Response(JSON.stringify({
    scanned: intents?.length || 0,
    line: lineCount, email: emailCount, skipped: skipCount,
    details: results,
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}));
