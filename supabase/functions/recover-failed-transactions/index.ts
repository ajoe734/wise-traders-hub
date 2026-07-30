// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// W4-3: T+24h 失敗 / 棄單 最後一次回收
// 每日 10:00 UTC+8（02:00 UTC）執行：掃 payment_intents pending 且
// created_at 落在 [now-26h, now-22h]、final_recovery_notified_at IS NULL 的訂單，
// 推送「換個付款方式」訊息（含 ECPay / LinePay / 匯款 三個 deep link），
// 之後把 status 標為 abandoned、寫入 final_recovery_notified_at 並 audit log。
//
// 與 W4-2 (recover-abandoned-checkout, 30m–2h) 互補：W4-2 是「還在猶豫」窗口、
// 本函式是「24h 都沒回來」最後一次嘗試，並結束生命週期。

import { serviceClient } from '../_shared/supabaseClients.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { withLogging } from '../_shared/edgeLogger.ts';

const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';
const RESEND_API_URL = 'https://api.resend.com/emails';

function buildLineFlex(productName: string, amount: number, urls: { ecpay: string; linepay: string; remittance: string }) {
  return {
    type: 'flex',
    altText: `最後提醒：${productName}（NT$${amount.toLocaleString()}）— 換個付款方式試試`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: '#FFE8E0', paddingAll: 'lg',
        contents: [{ type: 'text', text: '⏰ 最後提醒 — 換個付款方式？', weight: 'bold', size: 'md', color: '#B5371E' }],
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
            text: '您的訂單已經逾期 24 小時未完成。若先前付款失敗，換一個方式可能順利通過：',
            size: 'xs', color: '#666666', margin: 'lg', wrap: true,
          },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: 'lg',
        contents: [
          { type: 'button', style: 'primary', height: 'sm', color: '#EC662D',
            action: { type: 'uri', label: '信用卡（ECPay）', uri: urls.ecpay } },
          { type: 'button', style: 'primary', height: 'sm', color: '#00B900',
            action: { type: 'uri', label: 'LINE Pay', uri: urls.linepay } },
          { type: 'button', style: 'secondary', height: 'sm',
            action: { type: 'uri', label: 'ATM 匯款', uri: urls.remittance } },
        ],
      },
    },
  };
}

function buildFinalEmail(productName: string, amount: number, urls: { ecpay: string; linepay: string; remittance: string }) {
  const subject = `⏰ 最後提醒 — 您的訂單「${productName}」尚未完成`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#F5F3EF;padding:40px 0;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;">
    <h1 style="font-size:20px;color:#222;margin:0 0 16px;">最後提醒 — 換個付款方式？</h1>
    <p style="font-size:15px;color:#333;line-height:1.6;">
      您先前選擇了「<strong>${productName}</strong>」方案，但訂單已經逾期 24 小時未完成。<br>
      若先前付款失敗，換一個方式可能順利通過：
    </p>
    <div style="background:#FFF8E8;border-left:4px solid #EC662D;padding:12px 16px;margin:20px 0;border-radius:4px;">
      <p style="margin:0;font-size:14px;color:#333;">金額：<strong>NT$ ${amount.toLocaleString()}</strong></p>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;margin:24px 0;">
      <a href="${urls.ecpay}" style="display:block;background:#EC662D;color:#fff;padding:11px 18px;border-radius:6px;text-decoration:none;font-weight:600;text-align:center;">使用信用卡（ECPay）</a>
      <a href="${urls.linepay}" style="display:block;background:#00B900;color:#fff;padding:11px 18px;border-radius:6px;text-decoration:none;font-weight:600;text-align:center;">使用 LINE Pay</a>
      <a href="${urls.remittance}" style="display:block;background:#444;color:#fff;padding:11px 18px;border-radius:6px;text-decoration:none;font-weight:600;text-align:center;">改用 ATM 匯款</a>
    </div>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
    <p style="font-size:12px;color:#999;margin:0;">這是此訂單的最後一次提醒，若已完成或不再需要請忽略此通知。<br>此為系統自動發送，請勿直接回覆。</p>
  </div>
</body></html>`;
  return { subject, html };
}

Deno.serve(withLogging('recover-failed-transactions', async (req) => {
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
  const upper = new Date(now.getTime() - 22 * 60 * 60 * 1000);
  const lower = new Date(now.getTime() - 26 * 60 * 60 * 1000);

  const { data: intents, error: qErr } = await supabaseAdmin
    .from('payment_intents')
    .select('id, trade_no, user_id, product_kind, plan_id, checkup_plan_id, expert_id, amount, billing_cycle, created_at, expert_plans:plan_id(name, experts(name, slug)), checkup_plans:checkup_plan_id(name)')
    .eq('status', 'pending')
    .is('final_recovery_notified_at', null)
    .gte('created_at', lower.toISOString())
    .lt('created_at', upper.toISOString())
    .not('user_id', 'is', null);

  if (qErr) {
    console.error('query_failed', qErr);
    return new Response(JSON.stringify({ error: qErr.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let lineCount = 0, emailCount = 0, skipCount = 0;
  const details: any[] = [];

  for (const intent of intents || []) {
    const i: any = intent;
    let productName = '訂閱方案';
    const cycle = i.billing_cycle ? `&cycle=${i.billing_cycle}` : '';
    let urls = {
      ecpay: `${siteUrl}/account?utm_source=recovery&utm_campaign=failed_t24`,
      linepay: `${siteUrl}/account?utm_source=recovery&utm_campaign=failed_t24`,
      remittance: `${siteUrl}/account?utm_source=recovery&utm_campaign=failed_t24`,
    };

    if (i.product_kind === 'expert_plan' && i.expert_plans) {
      const plan = i.expert_plans as any;
      const expert = plan.experts as any;
      productName = `${expert?.name || ''} — ${plan?.name || ''}`;
      const base = `${siteUrl}/checkout/${expert?.slug}/${i.plan_id}`;
      urls = {
        ecpay: `${base}?method=ecpay${cycle}&utm_source=recovery&utm_campaign=failed_t24`,
        linepay: `${base}?method=linepay${cycle}&utm_source=recovery&utm_campaign=failed_t24`,
        remittance: `${base}?method=remittance${cycle}&utm_source=recovery&utm_campaign=failed_t24`,
      };
    } else if (i.product_kind === 'checkup' && i.checkup_plans) {
      const plan = i.checkup_plans as any;
      productName = `健檢 — ${plan?.name || ''}`;
      const base = `${siteUrl}/checkout/checkup/${i.checkup_plan_id}`;
      urls = {
        ecpay: `${base}?method=ecpay${cycle}&utm_source=recovery&utm_campaign=failed_t24`,
        linepay: `${base}?method=linepay${cycle}&utm_source=recovery&utm_campaign=failed_t24`,
        remittance: `${base}?method=remittance${cycle}&utm_source=recovery&utm_campaign=failed_t24`,
      };
    }

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
          const flex = buildLineFlex(productName, i.amount, urls);
          const res = await fetch(LINE_PUSH_URL, {
            signal: AbortSignal.timeout(10000),
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ to: binding.line_user_id, messages: [flex] }),
          });
          if (res.ok) { pushedVia = 'line'; lineCount++; }
          else console.error('line_push_failed', res.status, await res.text());
        }
      }
    }

    if (pushedVia === 'none' && resendKey) {
      const { data: userData } = await supabaseAdmin.auth.admin.getUserById(i.user_id);
      const rawEmail = userData?.user?.email;
      const userEmail = rawEmail && !rawEmail.endsWith('@line.local') ? rawEmail : null;
      if (userEmail) {
        const { subject, html } = buildFinalEmail(productName, i.amount, urls);
        const er = await fetch(RESEND_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
          body: JSON.stringify({ from: 'legendflow <noreply@legendflow.tw>', to: [userEmail], subject, html }),
        });
        if (er.ok) { pushedVia = 'email'; emailCount++; }
        else console.error('resend_failed', er.status, await er.text());
      }
    }

    if (pushedVia === 'none') skipCount++;

    // 標記為已最終通知並結束生命週期（status → abandoned）
    await supabaseAdmin
      .from('payment_intents')
      .update({
        final_recovery_notified_at: now.toISOString(),
        status: 'abandoned',
      })
      .eq('id', i.id);

    await supabaseAdmin.from('audit_logs').insert({
      actor_id: i.user_id,
      action: 'payment.failed_recovery_sent',
      target_type: 'payment_intent',
      target_id: i.id,
      detail: { via: pushedVia, product_kind: i.product_kind, amount: i.amount, age_hours: 24 },
    });

    details.push({ intent_id: i.id, via: pushedVia });
  }

  return new Response(JSON.stringify({
    scanned: intents?.length || 0,
    line: lineCount, email: emailCount, skipped: skipCount,
    details,
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}));
