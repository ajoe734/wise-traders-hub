// AUTH: webhook-signature  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { jsonResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabaseClients.ts";
import { withLogging } from "../_shared/edgeLogger.ts";
import { acpayGenerateSign as generateSign, acpayParseXml as parseXml, acpayExtractTxId, isDuplicatePaymentTx } from "../_shared/paymentVerify.ts";
import { createSubscriptionAndTransaction, recordPaymentForExistingSubscription, renewExistingSubscription } from "../_shared/paymentProcessor.ts";

// ACpay 3DS notify_url handler — must return plain text "SUCCESS"
const handler = withLogging("acpay-notify", async (req, log) => {
  try {
    const body = await req.text();
    log.info("raw_body_len", { len: body.length });
    const params = parseXml(body);

    const merchantKey = Deno.env.get("ACPAY_MERCHANT_KEY")!;
    // 簽章驗證強制 — 不接受未簽章請求（P0 防偽造）
    if (!params.sign) {
      log.error("sign_missing");
      return new Response("FAIL", { status: 200 });
    }
    const expectedSign = await generateSign(params, merchantKey);
    if (expectedSign !== params.sign) {
      log.error("sign_mismatch");
      return new Response("FAIL", { status: 200 });
    }

    const payResult = params.pay_result;
    const outTradeNo = params.out_trade_no;
    const totalFee = parseInt(params.total_fee || "0", 10);
    const transactionId = acpayExtractTxId(params);

    let metadata: any = {};
    try { metadata = JSON.parse(params.attach || "{}"); } catch {}
    const planId = metadata.plan_id;
    const billingCycle = metadata.billing_cycle;
    const userId = metadata.user_id;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (payResult !== "0") {
      log.info("payment_failed", { payResult });
      if (userId && planId) {
        try {
          await fetch(`${supabaseUrl}/functions/v1/notify-payment-failure`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
            body: JSON.stringify({ userId, planId, amount: totalFee, provider: "acpay",
              errorDetail: `pay_result: ${payResult}` }),
          });
        } catch (e) { log.error("notify_failure_failed", { message: (e as Error).message }); }
      }
      return new Response("SUCCESS", { status: 200 });
    }

    const supabase = serviceClient();

    if (await isDuplicatePaymentTx(supabase, transactionId)) {
      log.info("duplicate", { transactionId });
      return new Response("SUCCESS", { status: 200 });
    }

    const { data: provider } = await supabase
      .from("payment_providers").select("id")
      .eq("provider_type", "acpay").eq("is_active", true).single();

    const now = new Date();

    // W4-2: 標記 payment_intent 為已完成（用於棄單回收判定）
    await supabase.from("payment_intents")
      .update({ status: "completed", completed_at: now.toISOString() })
      .eq("trade_no", outTradeNo);

    let subscriptionId: string | null = null;
    if (userId && planId) {
      const { data: existing } = await supabase
        .from("member_subscriptions").select("id")
        .eq("user_id", userId).eq("plan_id", planId).eq("status", "active");

      if (existing && existing.length > 0) {
        subscriptionId = existing[0].id;
        const renewResult = await renewExistingSubscription(supabase, {
          subscriptionId: subscriptionId!, billingCycle, now,
        });
        if (renewResult.error) log.error("renewal_extend_error", { error: String(renewResult.error) });

        const { error: txError } = await recordPaymentForExistingSubscription(supabase, {
          subscriptionId: subscriptionId!, amount: totalFee, currency: "TWD",
          providerTxId: transactionId, providerId: provider?.id || null, now,
        });
        if (txError) log.error("tx_insert_error", { message: String(txError) });
      } else {
        const result = await createSubscriptionAndTransaction(supabase, {
          userId, planId, billingCycle, amount: totalFee, currency: "TWD",
          providerTxId: transactionId, providerId: provider?.id || null, now,
        });
        if (result.error) log.error("create_sub_tx_failed", { error: String(result.error) });
        else subscriptionId = result.subscriptionId;
      }
    } else {
      const { error: txError } = await supabase.from("payment_transactions").insert({
        amount: totalFee, currency: "TWD", status: "paid",
        paid_at: now.toISOString(),
        provider_id: provider?.id || null,
        provider_tx_id: transactionId, subscription_id: null,
      });
      if (txError) log.error("tx_insert_error", { message: txError.message });
    }

    void outTradeNo; void subscriptionId; void jsonResponse;
    return new Response("SUCCESS", { status: 200 });
  } catch (error) {
    log.error("uncaught", { message: (error as Error).message });
    return new Response("FAIL", { status: 200 });
  }
});

Deno.serve(handler);
