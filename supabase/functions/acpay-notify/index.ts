import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { acpayGenerateSign as generateSign, acpayParseXml as parseXml, acpayExtractTxId, isDuplicatePaymentTx } from "../_shared/paymentVerify.ts";
import { createSubscriptionAndTransaction, recordPaymentForExistingSubscription } from "../_shared/paymentProcessor.ts";

// ACpay 3DS notify_url handler (PDF section 4.6)
// Receives XML POST from ACpay after 3DS OTP verification
// Must return plain text "SUCCESS" on success

Deno.serve(async (req) => {
  // notify_url only receives POST from ACpay server, no CORS needed
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200 });
  }

  try {
    const body = await req.text();
    console.log("ACpay notify raw body:", body);

    const params = parseXml(body);
    console.log("ACpay notify parsed:", JSON.stringify(params));

    const merchantKey = Deno.env.get("ACPAY_MERCHANT_KEY")!;

    // Verify signature
    if (params.sign) {
      const expectedSign = await generateSign(params, merchantKey);
      if (expectedSign !== params.sign) {
        console.error("ACpay notify sign verification FAILED");
        return new Response("FAIL", { status: 200 });
      }
    }

    const payResult = params.pay_result;
    const outTradeNo = params.out_trade_no;
    const totalFee = parseInt(params.total_fee || "0", 10);
    const transactionId = acpayExtractTxId(params);

    // Parse metadata from attach field
    let metadata: any = {};
    try {
      metadata = JSON.parse(params.attach || "{}");
    } catch {
      console.error("Failed to parse attach field");
    }

    const planId = metadata.plan_id;
    const billingCycle = metadata.billing_cycle;
    const userId = metadata.user_id;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Payment failed
    if (payResult !== "0") {
      console.log("ACpay payment failed, pay_result:", payResult);
      if (userId && planId) {
        try {
          await fetch(`${supabaseUrl}/functions/v1/notify-payment-failure`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify({
              userId,
              planId,
              amount: totalFee,
              provider: "acpay",
              errorDetail: `pay_result: ${payResult}`,
            }),
          });
        } catch (e) {
          console.error("Failed to send payment failure notification:", e);
        }
      }
      return new Response("SUCCESS", { status: 200 });
    }

    // Payment successful — write to DB
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Duplicate check by provider_tx_id
    if (await isDuplicatePaymentTx(supabase, transactionId)) {
      console.log("Duplicate notification for:", transactionId);
      return new Response("SUCCESS", { status: 200 });
    }

    // Get ACpay provider
    const { data: provider } = await supabase
      .from("payment_providers")
      .select("id")
      .eq("provider_type", "acpay")
      .eq("is_active", true)
      .single();

    const now = new Date();

    let subscriptionId: string | null = null;
    if (userId && planId) {
      // Duplicate subscription protection
      const { data: existing } = await supabase
        .from("member_subscriptions")
        .select("id")
        .eq("user_id", userId)
        .eq("plan_id", planId)
        .eq("status", "active");

      if (existing && existing.length > 0) {
        console.log("Active subscription already exists, skipping insert");
        subscriptionId = existing[0].id;
        const { error: txError } = await recordPaymentForExistingSubscription(supabase, {
          subscriptionId: subscriptionId!,
          amount: totalFee,
          currency: "TWD",
          providerTxId: transactionId,
          providerId: provider?.id || null,
          now,
        });
        if (txError) console.error("Transaction insert error:", txError);
      } else {
        // 原子性建立訂閱 + 交易紀錄（若訂閱失敗不建立交易）
        const result = await createSubscriptionAndTransaction(supabase, {
          userId, planId, billingCycle, amount: totalFee, currency: "TWD",
          providerTxId: transactionId, providerId: provider?.id || null, now,
        });
        if (result.error) console.error("Failed to create subscription and transaction:", result.error);
        else subscriptionId = result.subscriptionId;
      }
    } else {
      // 無訂閱資訊時仍建立交易紀錄
      const { error: txError } = await supabase.from("payment_transactions").insert({
        amount: totalFee,
        currency: "TWD",
        status: "paid",
        paid_at: now.toISOString(),
        provider_id: provider?.id || null,
        provider_tx_id: transactionId,
        subscription_id: null,
      });
      if (txError) console.error("Transaction insert error:", txError);
    }

    console.log("ACpay notify processed successfully for:", outTradeNo);
    return new Response("SUCCESS", { status: 200 });
  } catch (error) {
    console.error("acpay-notify error:", error);
    return new Response("FAIL", { status: 200 });
  }
});
