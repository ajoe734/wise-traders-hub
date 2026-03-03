import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function hmacSha256Base64(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

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

    if (!simulate) {
      const nonce = crypto.randomUUID();
      const confirmBody = { amount, currency: "TWD" };
      const apiUri = `/v3/payments/${transactionId}/confirm`;
      const bodyStr = JSON.stringify(confirmBody);
      const signatureMessage = channelSecret + apiUri + bodyStr + nonce;
      const signature = await hmacSha256Base64(channelSecret, signatureMessage);

      const response = await fetch(`https://sandbox-api-pay.line.me${apiUri}`, {
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
        return new Response(JSON.stringify({ error: result.returnMessage || "Confirm failed", returnCode: result.returnCode }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      console.log("SIMULATE MODE: skipping LINE Pay Confirm API call");
    }

    // Write to DB using service role
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Get LINE Pay provider
    const { data: provider } = await supabase
      .from("payment_providers")
      .select("id")
      .eq("provider_type", "line_pay")
      .eq("is_active", true)
      .single();

    // Calculate expiry
    const now = new Date();
    const expiresAt = new Date(now);
    if (billingCycle === "yearly") {
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    } else {
      expiresAt.setMonth(expiresAt.getMonth() + 1);
    }

    // Create subscription if userId and planId provided
    let subscriptionId: string | null = null;
    if (userId && planId) {
      const { data: sub, error: subError } = await supabase
        .from("member_subscriptions")
        .insert({
          user_id: userId,
          plan_id: planId,
          status: "active",
          started_at: now.toISOString(),
          expires_at: expiresAt.toISOString(),
          provider_id: provider?.id || null,
        })
        .select("id")
        .single();

      if (subError) {
        console.error("Subscription insert error:", subError);
      } else {
        subscriptionId = sub.id;
      }
    }

    // Create payment transaction
    const { error: txError } = await supabase
      .from("payment_transactions")
      .insert({
        amount,
        currency: "TWD",
        status: "paid",
        paid_at: now.toISOString(),
        provider_id: provider?.id || null,
        provider_tx_id: String(transactionId),
        subscription_id: subscriptionId,
      });

    if (txError) {
      console.error("Transaction insert error:", txError);
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
