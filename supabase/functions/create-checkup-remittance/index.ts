import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const { checkupPlanId, billingCycle, originalAmount, discountAmount, discountReason, attribution } = await req.json();
    if (!checkupPlanId || !billingCycle) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Server-side price lookup
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: plan } = await admin.from("checkup_plans")
      .select("price_monthly, price_yearly, is_active")
      .eq("id", checkupPlanId).maybeSingle();
    if (!plan || !plan.is_active) {
      return new Response(JSON.stringify({ error: "Plan not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const basePrice = billingCycle === "yearly" ? plan.price_yearly : plan.price_monthly;

    // Honor client-provided cross-product discount, but server-side guard against negative
    const original = Number.isFinite(Number(originalAmount)) && Number(originalAmount) > 0
      ? Math.round(Number(originalAmount))
      : basePrice;
    const discount = Number.isFinite(Number(discountAmount)) && Number(discountAmount) > 0
      ? Math.min(Math.round(Number(discountAmount)), original)
      : 0;
    const amount = Math.max(0, original - discount);

    const { data, error } = await admin.from("remittance_orders").insert({
      user_id: userId,
      product_kind: "checkup_plan",
      checkup_plan_id: checkupPlanId,
      plan_id: null,
      billing_cycle: billingCycle,
      amount,
      original_amount: original,
      discount_amount: discount,
      discount_reason: discount > 0 ? (discountReason ?? null) : null,
      attribution: attribution ?? null,
      last5: null,
      payer_name: null,
      status: "awaiting_info",
    }).select("id").single();

    if (error) {
      console.error("remittance insert error:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ orderId: data.id, amount }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("create-checkup-remittance error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
