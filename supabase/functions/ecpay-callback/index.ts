// AUTH: webhook-signature  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { jsonResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabaseClients.ts";
import { withLogging } from "../_shared/edgeLogger.ts";
import { ecpayGenerateCheckMacValue as generateCheckMacValueAsync, ecpayExtractTxId, isDuplicatePaymentTx } from "../_shared/paymentVerify.ts";
import { createSubscriptionAndTransaction, recordPaymentForExistingSubscription, renewExistingSubscription } from "../_shared/paymentProcessor.ts";
import { loadEcpayCreds } from "../_shared/ecpayCredentials.ts";

const handler = withLogging("ecpay-callback", async (req, log) => {
  try {
    const formData = await req.formData();
    const params: Record<string, string> = {};
    for (const [key, value] of formData.entries()) params[key] = String(value);

    const receivedMac = params.CheckMacValue;
    const { CheckMacValue, ...paramsWithoutMac } = params;

    const supabase = serviceClient();
    const creds = await loadEcpayCreds(supabase);
    const expectedMac = await generateCheckMacValueAsync(paramsWithoutMac, creds.hashKey, creds.hashIV);

    if (receivedMac !== expectedMac) {
      // P4 D-20：CheckMacValue 屬於商家驗章，明碼進 log 等於把對齊樣本送給攻擊者；只留長度與末 4 碼指紋。
      const fp = (v: string | undefined) => v ? `len=${v.length}/tail=${v.slice(-4)}` : 'null';
      log.error("checkmacvalue_mismatch", { received_fp: fp(receivedMac), expected_fp: fp(expectedMac) });
      return new Response("0|CheckMacValue Error", { status: 200 });
    }

    const rtnCode = params.RtnCode;
    const tradeNo = params.MerchantTradeNo;
    const tradeAmt = parseInt(params.TradeAmt || "0");
    const planId = params.CustomField1;
    const billingCycle = params.CustomField2;
    const userId = params.CustomField4;

    if (rtnCode !== "1") {
      log.info("payment_not_successful", { rtnCode });
      if (userId && planId) {
        try {
          await fetch(`${Deno.env.get("SUPABASE_URL")!}/functions/v1/notify-payment-failure`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
            },
            body: JSON.stringify({
              userId, planId, amount: tradeAmt, provider: "ecpay",
              errorDetail: `RtnCode: ${rtnCode}, RtnMsg: ${params.RtnMsg || ""}`,
            }),
          });
        } catch (e) {
          log.error("notify_failure_failed", { message: (e as Error).message });
        }
      }
      return new Response("1|OK", { status: 200 });
    }

    const txId = ecpayExtractTxId(params);
    if (await isDuplicatePaymentTx(supabase, txId)) {
      log.info("duplicate", { txId });
      return new Response("1|OK", { status: 200 });
    }

    const { data: provider } = await supabase
      .from("payment_providers").select("id")
      .eq("provider_type", "ecpay").eq("is_active", true).single();

    const now = new Date();

    const { data: intent } = await supabase
      .from("payment_intents")
      .select("expert_id, original_amount, discount_amount, discount_reason, attribution, upgrade_from_subscription_id")
      .eq("trade_no", tradeNo).maybeSingle();

    // W4-2: 標記 payment_intent 為已完成（用於棄單回收判定）
    await supabase.from("payment_intents")
      .update({ status: "completed", completed_at: now.toISOString() })
      .eq("trade_no", tradeNo);

    if (intent?.upgrade_from_subscription_id && billingCycle === "yearly") {
      await supabase.from("member_subscriptions")
        .update({ status: "canceled", canceled_at: now.toISOString(), auto_renew: false })
        .eq("id", intent.upgrade_from_subscription_id);
    }

    let subscriptionId: string | null = null;
    if (userId && planId) {
      const { data: existing } = await supabase
        .from("member_subscriptions").select("id")
        .eq("user_id", userId).eq("plan_id", planId).eq("status", "active");

      if (existing && existing.length > 0) {
        const renewResult = await renewExistingSubscription(supabase, {
          subscriptionId: existing[0].id, billingCycle, now,
        });
        if (renewResult.error) log.error("renewal_extend_error", { message: String(renewResult.error) });

        const { error: txError } = await recordPaymentForExistingSubscription(supabase, {
          subscriptionId: existing[0].id,
          amount: tradeAmt, currency: "TWD",
          providerTxId: txId, providerId: provider?.id || null, now,
          originalAmount: intent?.original_amount ?? tradeAmt,
          discountAmount: intent?.discount_amount ?? 0,
          discountReason: intent?.discount_reason ?? null,
          attribution: intent?.attribution ?? null,
          productKind: "expert_plan",
          planId,
          expertId: intent?.expert_id ?? null,
        });
        if (txError) log.error("tx_insert_error", { message: String(txError) });
        return new Response("1|OK", { status: 200 });
      }

      const result = await createSubscriptionAndTransaction(supabase, {
        userId, planId, billingCycle, amount: tradeAmt, currency: "TWD",
        providerTxId: txId, providerId: provider?.id || null, now,
        originalAmount: intent?.original_amount ?? tradeAmt,
        discountAmount: intent?.discount_amount ?? 0,
        discountReason: intent?.discount_reason ?? null,
        attribution: intent?.attribution ?? null,
        productKind: "expert_plan",
        expertId: intent?.expert_id ?? null,
      });
      if (result.error) log.error("create_sub_tx_failed", { error: String(result.error) });
      else subscriptionId = result.subscriptionId;
    } else {
      const { error: txError } = await supabase.from("payment_transactions").insert({
        amount: tradeAmt, currency: "TWD", status: "paid",
        paid_at: now.toISOString(),
        provider_id: provider?.id || null,
        provider_tx_id: txId, subscription_id: null,
      });
      if (txError) log.error("tx_insert_error", { message: txError.message });
    }
    void subscriptionId;

    return new Response("1|OK", { status: 200 });
  } catch (error) {
    log.error("uncaught", { message: (error as Error).message });
    return new Response("0|Error", { status: 200 });
  }
});

Deno.serve(handler);
