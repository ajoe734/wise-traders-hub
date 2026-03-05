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
    const payload = await req.json();
    console.log("ACpay callback payload:", JSON.stringify(payload));

    // Verify partner key for authenticity
    const partnerKey = Deno.env.get("ACPAY_PARTNER_KEY")!;

    // ACpay callback structure (adjust based on actual ACpay API docs)
    const status = payload.status;
    const orderNumber = payload.order_number;
    const amount = payload.amount;
    const transactionId = payload.rec_trade_id || payload.transaction_id;
    const metadata = payload.metadata || {};

    const planId = metadata.plan_id;
    const billingCycle = metadata.billing_cycle;
    const userId = metadata.user_id;

    // Only process successful payments (status === 0 means success for most TW gateways)
    if (status !== 0) {
      console.log("ACpay payment not successful, status:", status);
      return new Response(JSON.stringify({ status: "ignored" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
        console.log("Active subscription already exists, skipping insert");
        return new Response(JSON.stringify({ status: "duplicate" }), {
          status: 200,
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
        console.log("Subscription created:", subscriptionId);
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
        provider_tx_id: String(transactionId || orderNumber),
        subscription_id: subscriptionId,
      });

    if (txError) {
      console.error("Transaction insert error:", txError);
    }

    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("acpay-callback error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
