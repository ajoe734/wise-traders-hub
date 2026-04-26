import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { acpayDeriveKeyAndIv as deriveKeyAndIv, acpayAesDecrypt as aesDecrypt, acpayRecurringExtractTxId, isDuplicatePaymentTx } from "../_shared/paymentVerify.ts";
import { extendSubscriptionExpiry } from "../_shared/subscriptionRenewal.ts";

// ACREC periodic billing notification handler (XLSX Page 3)
// Receives AES-encrypted JSON POST from ACpay ACREC engine
// Must return { err_code: "0", err_msg: "成功" }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200 });
  }

  try {
    const body = await req.json();
    console.log("ACREC notify raw body:", JSON.stringify(body));

    const merchantKey = Deno.env.get("ACPAY_MERCHANT_KEY")!;
    const nonceStr = body.nonce_str || "";
    const encryptedData = body.data || "";

    if (!nonceStr || !encryptedData) {
      console.error("Missing nonce_str or data");
      return new Response(JSON.stringify({ err_code: "1", err_msg: "Missing fields" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Decrypt
    const { key, iv } = deriveKeyAndIv(merchantKey, nonceStr);
    const decryptedStr = await aesDecrypt(encryptedData, key, iv);
    console.log("ACREC decrypted:", decryptedStr);

    const payload = JSON.parse(decryptedStr);
    const order = payload.order || payload;

    const payResult = String(order.currentPeriodPayResult ?? order.pay_result ?? "");
    const outTradeNo = order.out_trade_no || order.outTradeNo || "";
    const totalFee = parseInt(order.total_fee || order.totalFee || "0", 10);
    const transactionId = acpayRecurringExtractTxId(order);

    // Retrieve metadata
    let metadata: any = {};
    try {
      metadata = JSON.parse(order.attach || "{}");
    } catch {
      // attach might not be present in recurring notifications
    }

    const planId = metadata.plan_id || order.plan_id || "";
    const billingCycle = metadata.billing_cycle || order.billing_cycle || "monthly";
    const userId = metadata.user_id || order.user_id || "";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Payment failed
    if (payResult !== "0") {
      console.log("ACREC recurring payment failed, payResult:", payResult);
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
              errorDetail: `recurring payResult: ${payResult}`,
            }),
          });
        } catch (e) {
          console.error("Failed to send payment failure notification:", e);
        }
      }
      return new Response(JSON.stringify({ err_code: "0", err_msg: "成功" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Payment successful — update subscription expiry and record transaction
    const { data: provider } = await supabase
      .from("payment_providers")
      .select("id")
      .eq("provider_type", "acpay")
      .eq("is_active", true)
      .single();

    // Idempotency check: prevent duplicate processing of same transaction
    if (await isDuplicatePaymentTx(supabase, transactionId)) {
      console.log("ACREC duplicate notification for:", transactionId);
      return new Response(JSON.stringify({ err_code: "0", err_msg: "成功" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Find active subscription and extend expiry
    let subscriptionId: string | null = null;
    if (userId && planId) {
      const result = await extendSubscriptionExpiry(supabase, {
        userId,
        planId,
        billingCycle,
        now: new Date(),
      });
      if (result.error) {
        console.error("Subscription extend error:", result.error);
      } else {
        subscriptionId = result.subscriptionId;
        console.log("Subscription extended to:", result.newExpiresAt);
      }
    }

    // Record payment transaction
    const { error: txError } = await supabase.from("payment_transactions").insert({
      amount: totalFee,
      currency: "TWD",
      status: "paid",
      paid_at: new Date().toISOString(),
      provider_id: provider?.id || null,
      provider_tx_id: transactionId,
      subscription_id: subscriptionId,
    });

    if (txError) console.error("Transaction insert error:", txError);

    console.log("ACREC recurring payment processed for:", outTradeNo);
    return new Response(JSON.stringify({ err_code: "0", err_msg: "成功" }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("acpay-recurring-notify error:", error);
    return new Response(JSON.stringify({ err_code: "1", err_msg: (error as Error).message }), {
      headers: { "Content-Type": "application/json" },
    });
  }
});
