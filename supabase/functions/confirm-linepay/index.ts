import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { linepayHmacSha256Base64 as hmacSha256Base64 } from "../_shared/paymentVerify.ts";
import { createSubscriptionAndTransaction } from "../_shared/paymentProcessor.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { transactionId, orderId, amount, planId, billingCycle, userId, simulate } = await req.json();

    if (!transactionId || !orderId || !amount) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const channelId = Deno.env.get("LINEPAY_CHANNEL_ID")!;
    const channelSecret = Deno.env.get("LINEPAY_CHANNEL_SECRET")!;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!simulate) {
      const nonce = crypto.randomUUID();
      const confirmBody = { amount, currency: "TWD" };
      const apiUri = `/v3/payments/${transactionId}/confirm`;
      const bodyStr = JSON.stringify(confirmBody);
      const signatureMessage = channelSecret + apiUri + bodyStr + nonce;
      const signature = await hmacSha256Base64(channelSecret, signatureMessage);

      const linepayApiUrl = Deno.env.get("LINEPAY_API_URL") || "https://sandbox-api-pay.line.me";
      const response = await fetch(`${linepayApiUrl}${apiUri}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-LINE-ChannelId": channelId,
          "X-LINE-Authorization-Nonce": nonce,
          "X-LINE-Authorization": signature,
        },
        body: bodyStr,
      });

      const result = await response.json();

      if (result.returnCode !== "0000") {
        console.error("LINE Pay Confirm API error:", result);
        // Notify user of payment failure
        if (userId && planId) {
          try {
            const notifyUrl = `${supabaseUrl}/functions/v1/notify-payment-failure`;
            await fetch(notifyUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${serviceRoleKey}`,
              },
              body: JSON.stringify({
                userId,
                planId,
                amount,
                provider: "line_pay",
                errorDetail: `returnCode: ${result.returnCode}, msg: ${result.returnMessage || ""}`,
              }),
            });
          } catch (e) {
            console.error("Failed to send payment failure notification:", e);
          }
        }
        return new Response(JSON.stringify({ error: result.returnMessage || "Confirm failed", returnCode: result.returnCode }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      console.log("SIMULATE MODE: skipping LINE Pay Confirm API call");
    }

    // Write to DB using service role
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Get LINE Pay provider
    const { data: provider } = await supabase
      .from("payment_providers")
      .select("id")
      .eq("provider_type", "line_pay")
      .eq("is_active", true)
      .single();

    const now = new Date();

    // Duplicate subscription protection
    let subscriptionId: string | null = null;
    if (userId && planId) {
      const { data: existing } = await supabase
        .from("member_subscriptions")
        .select("id")
        .eq("user_id", userId)
        .eq("plan_id", planId)
        .eq("status", "active");

      if (existing && existing.length > 0) {
        return new Response(JSON.stringify({ success: true, subscriptionId: existing[0].id, duplicate: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // 原子性建立訂閱 + 交易紀錄（若訂閱失敗不建立交易）
      const result = await createSubscriptionAndTransaction(supabase, {
        userId, planId, billingCycle, amount, currency: "TWD",
        providerTxId: String(transactionId), providerId: provider?.id || null, now,
      });
      if (result.error) {
        console.error("Failed to create subscription and transaction:", result.error);
      } else {
        subscriptionId = result.subscriptionId;
      }
    } else {
      // 無訂閱資訊時仍建立交易紀錄
      const { error: txError } = await supabase
        .from("payment_transactions")
        .insert({
          amount,
          currency: "TWD",
          status: "paid",
          paid_at: now.toISOString(),
          provider_id: provider?.id || null,
          provider_tx_id: String(transactionId),
          subscription_id: null,
        });
      if (txError) console.error("Transaction insert error:", txError);
    }

    return new Response(
      JSON.stringify({ success: true, subscriptionId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("confirm-linepay error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
