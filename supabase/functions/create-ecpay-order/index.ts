import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const { planId, billingCycle, slug, amount, planName, expertName, origin, userId } =
      await req.json();

    if (!planId || !billingCycle || !slug || !amount || !origin) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const merchantId = Deno.env.get("ECPAY_MERCHANT_ID")!;
    const hashKey = Deno.env.get("ECPAY_HASH_KEY")!;
    const hashIV = Deno.env.get("ECPAY_HASH_IV")!;

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
      ChoosePayment: "ALL",
      EncryptType: "1",
      CustomField1: planId,
      CustomField2: billingCycle,
      CustomField3: slug,
      CustomField4: userId || "",
    };

    const checkMacValue = await generateCheckMacValueAsync(params, hashKey, hashIV);
    params.CheckMacValue = checkMacValue;

    // Return form params for client to submit
    return new Response(
      JSON.stringify({
        actionUrl: Deno.env.get("ECPAY_API_URL") || "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5",
        params,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("create-ecpay-order error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
