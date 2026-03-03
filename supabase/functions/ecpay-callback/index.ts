import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ECPay server callback - no CORS needed (server-to-server)
// But we add CORS for the client-side result check endpoint

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

  let encoded = encodeURIComponent(raw).toLowerCase();
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
    // ECPay sends callback as application/x-www-form-urlencoded
    const formData = await req.formData();
    const params: Record<string, string> = {};
    for (const [key, value] of formData.entries()) {
      params[key] = String(value);
    }

    console.log("ECPay callback params:", JSON.stringify(params));

    const receivedMac = params.CheckMacValue;
    const { CheckMacValue, ...paramsWithoutMac } = params;

    const hashKey = Deno.env.get("ECPAY_HASH_KEY")!;
    const hashIV = Deno.env.get("ECPAY_HASH_IV")!;

    // Verify CheckMacValue
    const expectedMac = await generateCheckMacValueAsync(paramsWithoutMac, hashKey, hashIV);

    if (receivedMac !== expectedMac) {
      console.error("CheckMacValue mismatch:", { received: receivedMac, expected: expectedMac });
      return new Response("0|CheckMacValue Error", { status: 200 });
    }

    const rtnCode = params.RtnCode;
    const tradeNo = params.MerchantTradeNo;
    const tradeAmt = parseInt(params.TradeAmt || "0");
    const ecpayTxId = params.TradeNo; // ECPay's transaction ID
    const planId = params.CustomField1;
    const billingCycle = params.CustomField2;

    // Only process successful payments
    if (rtnCode !== "1") {
      console.log("ECPay payment not successful, RtnCode:", rtnCode);
      return new Response("1|OK", { status: 200 });
    }

    // Write to DB
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Get ECPay provider
    const { data: provider } = await supabase
      .from("payment_providers")
      .select("id")
      .eq("provider_type", "ecpay")
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

    // We need user_id - store it in CustomField4 or look up via tradeNo
    // For now, create transaction record; subscription created when user returns
    const { error: txError } = await supabase
      .from("payment_transactions")
      .insert({
        amount: tradeAmt,
        currency: "TWD",
        status: "paid",
        paid_at: now.toISOString(),
        provider_id: provider?.id || null,
        provider_tx_id: ecpayTxId || tradeNo,
      });

    if (txError) {
      console.error("Transaction insert error:", txError);
    }

    // ECPay expects "1|OK" response
    return new Response("1|OK", { status: 200 });
  } catch (error) {
    console.error("ecpay-callback error:", error);
    return new Response("0|Error", { status: 200 });
  }
});
