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
    const { planId, billingCycle, slug, amount, planName, expertName, origin, userId } = await req.json();

    if (!planId || !billingCycle || !slug || !amount || !origin) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const partnerKey = Deno.env.get("ACPAY_PARTNER_KEY")!;
    const merchantId = Deno.env.get("ACPAY_MERCHANT_ID")!;
    const apiUrl = Deno.env.get("ACPAY_API_URL") || "https://sandbox-api.acpay.com.tw";

    const orderId = `AC${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const callbackUrl = `${supabaseUrl}/functions/v1/acpay-callback`;
    const returnUrl = `${origin}/app/checkout/${slug}/${planId}?acpay=result&billingCycle=${billingCycle}`;

    const itemName = `${expertName} - ${planName} (${billingCycle === "yearly" ? "年繳" : "月繳"})`;

    // ACpay uses SDK + Prime Token model
    // The frontend collects card info via ACpay JS SDK and sends a prime token
    // This endpoint creates the payment by pay-by-prime API
    const requestBody = {
      partner_key: partnerKey,
      merchant_id: merchantId,
      amount,
      currency: "TWD",
      order_number: orderId,
      details: itemName,
      cardholder: {
        phone_number: "",
        name: "",
        email: "",
      },
      result_url: {
        frontend_redirect_url: returnUrl,
        backend_notify_url: callbackUrl,
      },
      remember: false,
      three_domain_secure: false,
      // Custom fields for callback
      metadata: {
        plan_id: planId,
        billing_cycle: billingCycle,
        slug,
        user_id: userId || "",
      },
    };

    // If prime is provided (from frontend SDK), use pay-by-prime
    // Otherwise return config for frontend SDK initialization
    const body = await req.json().catch(() => null);

    return new Response(
      JSON.stringify({
        orderId,
        merchantId,
        amount,
        callbackUrl,
        returnUrl,
        apiUrl,
        // Frontend needs these to initialize ACpay SDK
        sdkConfig: {
          merchantId,
          apiUrl,
        },
        orderData: requestBody,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("create-acpay-order error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
