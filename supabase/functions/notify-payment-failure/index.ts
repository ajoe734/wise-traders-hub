import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { recordPaymentFailureInDB } from "../_shared/subscriptionRenewal.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
const RESEND_API_URL = "https://api.resend.com/emails";

interface NotifyPayload {
  userId: string;
  planId: string;
  amount: number;
  provider: string; // "line_pay" | "ecpay" | "acpay"
  errorDetail?: string;
}

async function sendLineMessage(channelToken: string, lineUserId: string, message: any) {
  const res = await fetch(LINE_PUSH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${channelToken}`,
    },
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
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "⚠️ 續訂扣款失敗",
            weight: "bold",
            size: "lg",
            color: "#DC3545",
          },
          {
            type: "text",
            text: `您訂閱的「${expertName} — ${planName}」扣款失敗（NT$ ${amount.toLocaleString()}）。`,
            size: "sm",
            color: "#444444",
            margin: "md",
            wrap: true,
          },
          { type: "separator", margin: "lg" },
          {
            type: "text",
            text: "請確認付款方式是否正常，並重新訂閱以繼續享受服務。",
            size: "sm",
            color: "#666666",
            margin: "lg",
            wrap: true,
          },
          {
            type: "text",
            text: "如有任何問題，請聯繫客服。",
            size: "xs",
            color: "#999999",
            margin: "md",
            wrap: true,
          },
        ],
      },
    },
  };
}

function buildPaymentFailureEmail(
  planName: string,
  expertName: string,
  amount: number,
  isRenewal: boolean
) {
  const subject = isRenewal
    ? `⚠️ 續訂扣款失敗 — ${planName}`
    : `⚠️ 訂閱付款失敗 — ${planName}`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: 'Helvetica Neue', Arial, sans-serif; background: #f5f5f5; padding: 40px 0;">
  <div style="max-width: 520px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
    <h1 style="font-size: 20px; color: #DC3545; margin: 0 0 16px;">⚠️ ${isRenewal ? "續訂扣款失敗" : "訂閱付款失敗"}</h1>
    <p style="font-size: 15px; color: #333; line-height: 1.6;">
      您${isRenewal ? "訂閱" : "嘗試訂閱"}的「<strong>${expertName} — ${planName}</strong>」付款失敗。
    </p>
    <div style="background: #FFF3F3; border-left: 4px solid #DC3545; padding: 12px 16px; margin: 20px 0; border-radius: 4px;">
      <p style="margin: 0; font-size: 14px; color: #333;">
        金額：<strong>NT$ ${amount.toLocaleString()}</strong>
      </p>
    </div>
    <p style="font-size: 14px; color: #555; line-height: 1.6;">
      請確認您的付款方式是否正常（信用卡額度、帳戶餘額等），並${isRenewal ? "重新訂閱" : "再次嘗試訂閱"}以繼續享受服務。
    </p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
    <p style="font-size: 12px; color: #999; margin: 0;">
      如有任何問題，請聯繫客服團隊。<br>
      此為系統自動發送，請勿直接回覆此信件。
    </p>
  </div>
</body>
</html>`;

  return { subject, html };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId, planId, amount, provider, errorDetail } =
      (await req.json()) as NotifyPayload;

    if (!userId || !planId) {
      return new Response(
        JSON.stringify({ error: "Missing userId or planId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // 1. Get plan + expert info
    const { data: plan } = await supabase
      .from("expert_plans")
      .select("name, expert_id, experts(name, id)")
      .eq("id", planId)
      .single();

    const planName = plan?.name || "未知方案";
    const expert = plan?.experts as any;
    const expertName = expert?.name || "分析師";
    const expertId = expert?.id || plan?.expert_id;

    // 2. Get user email
    const { data: userData } = await supabase.auth.admin.getUserById(userId);
    const userEmail = userData?.user?.email;

    // 3. Check if user has LINE binding (= renewal subscriber)
    let hasLineBinding = false;
    let lineUserId: string | null = null;
    let channelToken: string | null = null;

    if (expertId) {
      const { data: binding } = await supabase
        .from("member_line_bindings")
        .select("line_user_id")
        .eq("user_id", userId)
        .eq("expert_id", expertId)
        .eq("is_active", true)
        .maybeSingle();

      if (binding?.line_user_id) {
        hasLineBinding = true;
        lineUserId = binding.line_user_id;

        const { data: channel } = await supabase
          .from("expert_line_channels")
          .select("channel_access_token")
          .eq("expert_id", expertId)
          .eq("is_active", true)
          .maybeSingle();

        channelToken = channel?.channel_access_token || null;
      }
    }

    const isRenewal = hasLineBinding;
    console.log("Payment failure notification:", {
      userId,
      planId,
      isRenewal,
      hasLineBinding,
      hasEmail: !!userEmail,
      provider,
    });

    // 4. Send LINE notification (renewal subscribers only)
    let lineSent = false;
    if (isRenewal && lineUserId && channelToken) {
      const lineMsg = buildPaymentFailureLineMessage(planName, expertName, amount);
      lineSent = await sendLineMessage(channelToken, lineUserId, lineMsg);
      console.log("LINE notification sent:", lineSent);
    }

    // 5. Send email notification (always)
    let emailSent = false;
    if (userEmail) {
      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (resendKey) {
        const { subject, html } = buildPaymentFailureEmail(
          planName,
          expertName,
          amount,
          isRenewal
        );

        const emailRes = await fetch(RESEND_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${resendKey}`,
          },
          body: JSON.stringify({
            from: "WiseTraders <noreply@wisetraders.tw>",
            to: [userEmail],
            subject,
            html,
          }),
        });

        if (emailRes.ok) {
          emailSent = true;
          console.log("Email notification sent to:", userEmail);
        } else {
          const errBody = await emailRes.text();
          console.error("Resend email failed:", emailRes.status, errBody);
        }
      } else {
        console.warn("RESEND_API_KEY not configured, skipping email");
      }
    }

    // 6. Fetch provider id
    const { data: providerRow } = await supabase
      .from("payment_providers")
      .select("id")
      .eq("provider_type", provider || "ecpay")
      .eq("is_active", true)
      .maybeSingle();

    // 7. Record failed transaction + audit log
    await recordPaymentFailureInDB(supabase, {
      userId,
      planId,
      amount,
      provider,
      providerId: providerRow?.id || null,
      isRenewal,
      lineSent,
      emailSent,
      errorDetail: errorDetail || null,
    });

    return new Response(
      JSON.stringify({
        success: true,
        lineSent,
        emailSent,
        isRenewal,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("notify-payment-failure error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
