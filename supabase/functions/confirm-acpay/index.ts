import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const { prime, amount, planId, billingCycle, userId, orderId, simulate } = await req.json();

    if (!amount || !planId) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const partnerKey = Deno.env.get("ACPAY_PARTNER_KEY")!;
    const merchantId = Deno.env.get("ACPAY_MERCHANT_ID")!;
    const apiUrl = Deno.env.get("ACPAY_API_URL") || "https://sandbox-api.acpay.com.tw";

    let transactionId = orderId || `AC-SIM-${Date.now()}`;

    if (!simulate && prime) {
      // Call ACpay pay-by-prime API
      const payResponse = await fetch(`${apiUrl}/tpc/payment/pay-by-prime`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": partnerKey,
        },
        body: JSON.stringify({
          partner_key: partnerKey,
          prime,
          merchant_id: merchantId,
          amount,
          currency: "TWD",
          order_number: orderId,
          details: "訂閱方案",
        }),
      });

      const payResult = await payResponse.json();
      console.log("ACpay pay-by-prime result:", JSON.stringify(payResult));

      if (payResult.status !== 0) {
        return new Response(JSON.stringify({ error: payResult.msg || "Payment failed", status: payResult.status }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      transactionId = payResult.rec_trade_id || transactionId;
    } else {
      console.log("SIMULATE MODE: skipping ACpay pay-by-prime API call");
    }

    // Write to DB using service role
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Get ACpay provider
    const { data: provider } = await supabase
      .from("payment_providers")
      .select("id")
      .eq("provider_type", "acpay")
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
    console.error("confirm-acpay error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
