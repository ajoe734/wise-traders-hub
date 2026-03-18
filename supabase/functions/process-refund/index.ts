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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify JWT using getClaims
    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub as string;

    const { subscription_id, refund_amount, used_days, total_days, original_amount } = await req.json();

    if (!subscription_id || refund_amount === undefined) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use service role client to bypass RLS
    const adminClient = createClient(supabaseUrl, serviceKey);

    // Verify the subscription belongs to this user
    const { data: sub, error: subError } = await adminClient
      .from("member_subscriptions")
      .select("id, user_id, plan_id")
      .eq("id", subscription_id)
      .single();

    if (subError || !sub || sub.user_id !== userId) {
      return new Response(JSON.stringify({ error: "Subscription not found or not yours" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Look up the original payment transaction to get provider_id for future real refund API calls
    const { data: originalTx } = await adminClient
      .from("payment_transactions")
      .select("id, provider_id, provider_tx_id")
      .eq("subscription_id", subscription_id)
      .eq("status", "paid")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // Insert refund record into payment_transactions
    // Links to the same provider_id so real refund API can be called later
    const { error: txError } = await adminClient
      .from("payment_transactions")
      .insert({
        subscription_id,
        amount: -Math.abs(refund_amount),
        status: "refunded",
        paid_at: new Date().toISOString(),
        provider_id: originalTx?.provider_id || null,
        provider_tx_id: originalTx?.provider_tx_id
          ? `REFUND-${originalTx.provider_tx_id}`
          : null,
      });

    if (txError) {
      console.error("Failed to insert refund transaction:", txError);
      return new Response(JSON.stringify({ error: "Failed to create refund record" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Insert audit log
    const { error: auditError } = await adminClient
      .from("audit_logs")
      .insert({
        action: "prorated_refund",
        actor_id: userId,
        target_id: subscription_id,
        target_type: "member_subscriptions",
        detail: {
          reason: "按比例退款",
          used_days,
          total_days,
          refund_amount,
          original_amount,
        },
      });

    if (auditError) {
      console.error("Failed to insert audit log:", auditError);
    }

    return new Response(JSON.stringify({ success: true, refund_amount }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("process-refund error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
