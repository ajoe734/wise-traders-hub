// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { jsonResponse } from "../_shared/cors.ts";
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { serviceClient } from "../_shared/supabaseClients.ts";
import { withLogging } from "../_shared/edgeLogger.ts";
import { recordPaymentFailureInDB } from "../_shared/subscriptionRenewal.ts";
import { validateInput, validationJsonResponse } from "../_shared/inputValidator.ts";

const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
const RESEND_API_URL = "https://api.resend.com/emails";

interface NotifyPayload {
  userId: string;
  planId: string;
  amount: number;
  provider: string;
  errorDetail?: string;
}

async function sendLineMessage(channelToken: string, lineUserId: string, message: any) {
  const res = await fetch(LINE_PUSH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${channelToken}` },
    body: JSON.stringify({ to: lineUserId, messages: [message] }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    console.error("LINE push failed:", res.status, errBody);
    return false;
  }
  return true;
}

function buildPaymentFailureLineMessage(planName: string, expertName: string, amount: number) {
  return {
    type: "flex",
    altText: `⚠️ 續訂扣款失敗 — ${planName}`,
    contents: {
      type: "bubble",
      body: {
        type: "box", layout: "vertical",
        contents: [
          { type: "text", text: "⚠️ 續訂扣款失敗", weight: "bold", size: "lg", color: "#DC3545" },
          { type: "text", text: `您訂閱的「${expertName} — ${planName}」扣款失敗（NT$ ${amount.toLocaleString()}）。`, size: "sm", color: "#444444", margin: "md", wrap: true },
          { type: "separator", margin: "lg" },
          { type: "text", text: "請確認付款方式是否正常，並重新訂閱以繼續享受服務。", size: "sm", color: "#666666", margin: "lg", wrap: true },
          { type: "text", text: "如有任何問題，請聯繫客服。", size: "xs", color: "#999999", margin: "md", wrap: true },
        ],
      },
    },
  };
}

function buildPaymentFailureEmail(
  planName: string, expertName: string, amount: number, isRenewal: boolean,
  retryUrls?: { ecpay: string; linepay: string; remittance: string },
) {
  const subject = isRenewal ? `⚠️ 續訂扣款失敗 — ${planName}` : `⚠️ 訂閱付款失敗 — ${planName}`;
  const retryBlock = retryUrls ? `
    <p style="font-size:14px;color:#333;margin:20px 0 10px;font-weight:600;">換個付款方式試試：</p>
    <div style="display:flex;flex-direction:column;gap:8px;">
      <a href="${retryUrls.ecpay}" style="display:block;background:#EC662D;color:#fff;padding:11px 18px;border-radius:6px;text-decoration:none;font-weight:600;text-align:center;">使用信用卡（ECPay）</a>
      <a href="${retryUrls.linepay}" style="display:block;background:#00B900;color:#fff;padding:11px 18px;border-radius:6px;text-decoration:none;font-weight:600;text-align:center;">使用 LINE Pay</a>
      <a href="${retryUrls.remittance}" style="display:block;background:#444;color:#fff;padding:11px 18px;border-radius:6px;text-decoration:none;font-weight:600;text-align:center;">改用 ATM 匯款</a>
    </div>` : '';
  const html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family: 'Helvetica Neue', Arial, sans-serif; background: #f5f5f5; padding: 40px 0;">
  <div style="max-width: 520px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
    <h1 style="font-size: 20px; color: #DC3545; margin: 0 0 16px;">⚠️ ${isRenewal ? "續訂扣款失敗" : "訂閱付款失敗"}</h1>
    <p style="font-size: 15px; color: #333; line-height: 1.6;">
      您${isRenewal ? "訂閱" : "嘗試訂閱"}的「<strong>${expertName} — ${planName}</strong>」付款失敗。
    </p>
    <div style="background: #FFF3F3; border-left: 4px solid #DC3545; padding: 12px 16px; margin: 20px 0; border-radius: 4px;">
      <p style="margin: 0; font-size: 14px; color: #333;">金額：<strong>NT$ ${amount.toLocaleString()}</strong></p>
    </div>
    ${retryBlock}
    <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
    <p style="font-size: 12px; color: #999; margin: 0;">如有任何問題，請聯繫客服團隊。<br>此為系統自動發送，請勿直接回覆此信件。</p>
  </div>
</body></html>`;
  return { subject, html };
}

const handler = withLogging("notify-payment-failure", async (req, log) => {
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

  const payload = (await req.json()) as NotifyPayload;
  const issues = validateInput({
    fields: {
      userId: { required: true, type: 'string', label: 'userId' },
      planId: { required: true, type: 'string', label: 'planId' },
      amount: { required: true, type: 'number', acceptTypes: ['string'], label: 'amount' },
      provider: { required: true, type: 'string', label: 'provider', oneOf: ['ecpay', 'linepay', 'acpay', 'remittance'] },
      errorDetail: { required: false, type: 'string', label: 'errorDetail' },
    },
    source: payload,
  });
  if (issues.length) return validationJsonResponse(issues);
  const { userId, planId, amount, provider, errorDetail } = payload;

  const supabase = serviceClient();

  const { data: plan } = await supabase
    .from("expert_plans").select("name, expert_id, experts(name, id, slug)").eq("id", planId).single();
  const planName = plan?.name || "未知方案";
  const expert = plan?.experts as any;
  const expertName = expert?.name || "分析師";
  const expertId = expert?.id || plan?.expert_id;
  const expertSlug = expert?.slug;

  const { data: userData } = await supabase.auth.admin.getUserById(userId);
  // Line virtual emails (`line_{id}@line.local`) are not deliverable — skip to avoid Resend bounces.
  const rawEmail = userData?.user?.email;
  const userEmail = rawEmail && !rawEmail.endsWith('@line.local') ? rawEmail : null;

  let hasLineBinding = false;
  let lineUserId: string | null = null;
  let channelToken: string | null = null;

  if (expertId) {
    const { data: binding } = await supabase
      .from("member_line_bindings").select("line_user_id")
      .eq("user_id", userId).eq("expert_id", expertId).eq("is_active", true).maybeSingle();

    if (binding?.line_user_id) {
      hasLineBinding = true;
      lineUserId = binding.line_user_id;
      const { data: channel } = await supabase
        .from("expert_line_channels").select("channel_access_token")
        .eq("expert_id", expertId).eq("is_active", true).maybeSingle();
      channelToken = channel?.channel_access_token || null;
    }
  }

  const isRenewal = hasLineBinding;
  log.info("notify_start", { userId, planId, isRenewal, hasLineBinding, hasEmail: !!userEmail, provider });

  let lineSent = false;
  if (isRenewal && lineUserId && channelToken) {
    const lineMsg = buildPaymentFailureLineMessage(planName, expertName, amount);
    lineSent = await sendLineMessage(channelToken, lineUserId, lineMsg);
  }

  let emailSent = false;
  if (userEmail) {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (resendKey) {
      const siteUrl = (Deno.env.get("SITE_URL") || "https://legendflow.tw").replace(/\/$/, "");
      const retryUrls = expertSlug ? {
        ecpay: `${siteUrl}/checkout/${expertSlug}/${planId}?method=ecpay&utm_source=retry&utm_campaign=payment_failure`,
        linepay: `${siteUrl}/checkout/${expertSlug}/${planId}?method=linepay&utm_source=retry&utm_campaign=payment_failure`,
        remittance: `${siteUrl}/checkout/${expertSlug}/${planId}?method=remittance&utm_source=retry&utm_campaign=payment_failure`,
      } : undefined;
      const { subject, html } = buildPaymentFailureEmail(planName, expertName, amount, isRenewal, retryUrls);
      const emailRes = await fetch(RESEND_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: "legendflow <noreply@legendflow.tw>",
          to: [userEmail], subject, html,
        }),
      });
      if (emailRes.ok) emailSent = true;
      else log.error("resend_email_failed", { status: emailRes.status, body: await emailRes.text() });
    } else {
      log.warn("resend_key_missing");
    }
  }

  const { data: providerRow } = await supabase
    .from("payment_providers").select("id")
    .eq("provider_type", provider || "ecpay").eq("is_active", true).maybeSingle();

  await recordPaymentFailureInDB(supabase, {
    userId, planId, amount, provider,
    providerId: providerRow?.id || null,
    isRenewal, lineSent, emailSent,
    errorDetail: errorDetail || null,
  });

  return jsonResponse({ success: true, lineSent, emailSent, isRenewal });
});

Deno.serve(handler);
