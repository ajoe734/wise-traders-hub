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
    const ecpayTxId = params.TradeNo;
    const planId = params.CustomField1;
    const billingCycle = params.CustomField2;
    const slug = params.CustomField3;
    const userId = params.CustomField4;

    // Payment failed — notify user
    if (rtnCode !== "1") {
      console.log("ECPay payment not successful, RtnCode:", rtnCode);
      if (userId && planId) {
        try {
          const notifyUrl = `${Deno.env.get("SUPABASE_URL")!}/functions/v1/notify-payment-failure`;
          await fetch(notifyUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
            },
            body: JSON.stringify({
              userId,
              planId,
              amount: tradeAmt,
              provider: "ecpay",
              errorDetail: `RtnCode: ${rtnCode}, RtnMsg: ${params.RtnMsg || ""}`,
            }),
          });
        } catch (e) {
          console.error("Failed to send payment failure notification:", e);
        }
      }
      return new Response("1|OK", { status: 200 });
    }

    // Write to DB
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Idempotency check: prevent duplicate processing
    const txId = ecpayTxId || tradeNo;
    const { data: existingTx } = await supabase
      .from("payment_transactions")
      .select("id")
      .eq("provider_tx_id", txId)
      .eq("status", "paid");

    if (existingTx && existingTx.length > 0) {
      console.log("ECPay duplicate notification for:", txId);
      return new Response("1|OK", { status: 200 });
    }

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
        // Still create the transaction record for payment tracking
        await supabase.from("payment_transactions").insert({
          amount: tradeAmt,
          currency: "TWD",
          status: "paid",
          paid_at: now.toISOString(),
          provider_id: provider?.id || null,
          provider_tx_id: ecpayTxId || tradeNo,
          subscription_id: existing[0].id,
        });
        return new Response("1|OK", { status: 200 });
      }

      const { data: subData, error: subError } = await supabase
        .from("member_subscriptions")
        .insert({
          user_id: userId,
          plan_id: planId,
          status: "active",
          provider_id: provider?.id || null,
          started_at: now.toISOString(),
          expires_at: expiresAt.toISOString(),
        })
        .select("id")
        .single();

      if (subError) {
        console.error("Subscription insert error:", subError);
      } else {
        subscriptionId = subData?.id || null;
        console.log("Subscription created:", subscriptionId);
      }
    }

    // Create transaction record
    const { error: txError } = await supabase
      .from("payment_transactions")
      .insert({
        amount: tradeAmt,
        currency: "TWD",
        status: "paid",
        paid_at: now.toISOString(),
        provider_id: provider?.id || null,
        provider_tx_id: ecpayTxId || tradeNo,
        subscription_id: subscriptionId,
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
