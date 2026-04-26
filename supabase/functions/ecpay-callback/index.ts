import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { ecpayGenerateCheckMacValue as generateCheckMacValueAsync, ecpayExtractTxId, isDuplicatePaymentTx } from "../_shared/paymentVerify.ts";
import { createSubscriptionAndTransaction, recordPaymentForExistingSubscription } from "../_shared/paymentProcessor.ts";

// ECPay server callback - no CORS needed (server-to-server)
// But we add CORS for the client-side result check endpoint

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
    const txId = ecpayExtractTxId(params);
    if (await isDuplicatePaymentTx(supabase, txId)) {
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

    const now = new Date();

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
        const { error: txError } = await recordPaymentForExistingSubscription(supabase, {
          subscriptionId: existing[0].id,
          amount: tradeAmt,
          currency: "TWD",
          providerTxId: txId,
          providerId: provider?.id || null,
          now,
        });
        if (txError) console.error("Transaction insert error:", txError);
        return new Response("1|OK", { status: 200 });
      }

      // 原子性建立訂閱 + 交易紀錄（若訂閱失敗不建立交易）
      const result = await createSubscriptionAndTransaction(supabase, {
        userId, planId, billingCycle, amount: tradeAmt, currency: "TWD",
        providerTxId: txId, providerId: provider?.id || null, now,
      });
      if (result.error) {
        console.error("Failed to create subscription and transaction:", result.error);
      } else {
        subscriptionId = result.subscriptionId;
        console.log("Subscription created:", subscriptionId);
      }
    } else {
      // 無訂閱資訊時仍建立交易紀錄
      const { error: txError } = await supabase
        .from("payment_transactions")
        .insert({
          amount: tradeAmt,
          currency: "TWD",
          status: "paid",
          paid_at: now.toISOString(),
          provider_id: provider?.id || null,
          provider_tx_id: txId,
          subscription_id: null,
        });
      if (txError) console.error("Transaction insert error:", txError);
    }

    // ECPay expects "1|OK" response
    return new Response("1|OK", { status: 200 });
  } catch (error) {
    console.error("ecpay-callback error:", error);
    return new Response("0|Error", { status: 200 });
  }
});
