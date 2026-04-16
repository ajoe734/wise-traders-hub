import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { processRefundInDB } from "../_shared/refundProcessor.ts";

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

    // Verify JWT
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

    const { subscription_id, refund_amount, remaining_months, original_amount, monthly_price } = await req.json();

    if (!subscription_id || refund_amount === undefined) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ISSUE-008: Server-side validation — refund must not exceed original paid amount
    if (refund_amount < 0) {
      return new Response(JSON.stringify({ error: "Invalid refund amount" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    const result = await processRefundInDB(adminClient, {
      subscriptionId: subscription_id,
      userId,
      refundAmount: refund_amount,
      remainingMonths: remaining_months,
      originalAmount: original_amount,
      monthlyPrice: monthly_price,
    });

    if (result.alreadyRefunded) {
      return new Response(JSON.stringify({ success: true, message: "已退款", refund_amount }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!result.success) {
      console.error("Failed to create refund record:", result.error);
      return new Response(JSON.stringify({ error: "Failed to create refund record" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, refund_amount: result.cappedRefundAmount }), {
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
