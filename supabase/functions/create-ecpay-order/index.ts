import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { loadEcpayCreds } from "../_shared/ecpayCredentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function generateCheckMacValueAsync(
  params: Record<string, string>,
  hashKey: string,
  hashIV: string
): Promise<string> {
  const sorted = Object.keys(params)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((key) => `${key}=${params[key]}`)
    .join("&");

  const raw = `HashKey=${hashKey}&${sorted}&HashIV=${hashIV}`;

  // ECPay specific URL encoding
  let encoded = encodeURIComponent(raw).toLowerCase();
  // ECPay .NET style encoding differences
  encoded = encoded
    .replace(/%2d/g, "-")
    .replace(/%5f/g, "_")
    .replace(/%2e/g, ".")
    .replace(/%21/g, "!")
    .replace(/%2a/g, "*")
    .replace(/%28/g, "(")
    .replace(/%29/g, ")")
    .replace(/%20/g, "+")
    .replace(/%7e/g, "~");

  // SHA256
  const encoder = new TextEncoder();
  const data = encoder.encode(encoded);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  return hashHex.toUpperCase();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      planId, billingCycle, slug, amount, planName, expertName, origin, userId,
      originalAmount, discountAmount, discountReason, attribution, expertId,
      upgradeFromSubscriptionId,
    } = body;

    if (!planId || !billingCycle || !slug || !amount || !origin) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrlForCreds = Deno.env.get("SUPABASE_URL")!;
    const serviceKeyForCreds = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const credsClient = createClient(supabaseUrlForCreds, serviceKeyForCreds);
    const creds = await loadEcpayCreds(credsClient);
    const merchantId = creds.merchantId;
    const hashKey = creds.hashKey;
    const hashIV = creds.hashIV;

    const tradeNo = `EC${Date.now().toString().slice(-13)}`;
    const now = new Date();
    const tradeDate = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

    // Callback and return URLs
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const returnUrl = `${origin}/app/checkout/${slug}/${planId}?ecpay=result&billingCycle=${billingCycle}`;
    const notifyUrl = `${supabaseUrl}/functions/v1/ecpay-callback`;

    const itemName = `${expertName} - ${planName} (${billingCycle === "yearly" ? "年繳" : "月繳"})`;

    const params: Record<string, string> = {
      MerchantID: merchantId,
      MerchantTradeNo: tradeNo,
      MerchantTradeDate: tradeDate,
      PaymentType: "aio",
      TotalAmount: String(amount),
      TradeDesc: "Subscription",
      ItemName: itemName,
      ReturnURL: notifyUrl,
      ClientBackURL: returnUrl,
      ChoosePayment: "Credit",
      EncryptType: "1",
      CustomField1: planId,
      CustomField2: billingCycle,
      CustomField3: slug,
      CustomField4: userId || "",
    };

    const checkMacValue = await generateCheckMacValueAsync(params, hashKey, hashIV);
    params.CheckMacValue = checkMacValue;

    // Stage 3: persist payment intent for callback to read attribution/discount
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const sb = createClient(supabaseUrl, serviceKey);
      await sb.from("payment_intents").insert({
        trade_no: tradeNo,
        user_id: userId || null,
        product_kind: "expert_plan",
        plan_id: planId,
        expert_id: expertId || null,
        billing_cycle: billingCycle,
        original_amount: originalAmount ?? amount,
        discount_amount: discountAmount ?? 0,
        discount_reason: discountReason ?? null,
        amount,
        attribution: attribution ?? null,
        upgrade_from_subscription_id: upgradeFromSubscriptionId ?? null,
      });
    } catch (e) {
      console.error("payment_intents insert failed (non-fatal):", e);
    }

    // Return form params for client to submit
    return new Response(
      JSON.stringify({
        actionUrl: creds.creditActionUrl,
        params,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("create-ecpay-order error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
