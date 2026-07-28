// AUTH: webhook-signature  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { jsonResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabaseClients.ts";
import { withLogging } from "../_shared/edgeLogger.ts";
import { ecpayGenerateCheckMacValue, ecpayExtractTxId, isDuplicatePaymentTx } from "../_shared/paymentVerify.ts";
import { writeRevenueSplit } from "../_shared/paymentProcessor.ts";
import { loadEcpayCreds } from "../_shared/ecpayCredentials.ts";

const handler = withLogging("checkup-ecpay-callback", async (req, log) => {
  try {
    const formData = await req.formData();
    const params: Record<string, string> = {};
    for (const [key, value] of formData.entries()) params[key] = String(value);

    const receivedMac = params.CheckMacValue;
    const { CheckMacValue, ...paramsWithoutMac } = params;
    const supabase = serviceClient();
    const creds = await loadEcpayCreds(supabase);
    const expected = await ecpayGenerateCheckMacValue(paramsWithoutMac, creds.hashKey, creds.hashIV);

    if (receivedMac !== expected) {
      log.error("checkmacvalue_mismatch");
      return new Response("0|CheckMacValue Error", { status: 200 });
    }

    const rtnCode = params.RtnCode;
    const tradeAmt = parseInt(params.TradeAmt || "0");
    const customField1 = params.CustomField1 || "";
    const billingCycle = params.CustomField2;
    const userId = params.CustomField4;

    if (!customField1.startsWith("CK:")) {
      log.info("not_checkup_order");
      return new Response("1|OK", { status: 200 });
    }
    const checkupPlanId = customField1.slice(3);

    if (rtnCode !== "1") {
      log.info("payment_failed", { rtnCode });
      return new Response("1|OK", { status: 200 });
    }

    const txId = ecpayExtractTxId(params);
    if (await isDuplicatePaymentTx(supabase, txId)) {
      log.info("duplicate", { txId });
      return new Response("1|OK", { status: 200 });
    }

    const { data: provider } = await supabase
      .from("payment_providers").select("id")
      .eq("provider_type", "ecpay").eq("is_active", true).maybeSingle();

    const now = new Date();
    const expiresAt = new Date(now);
    if (billingCycle === "yearly") expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    else expiresAt.setMonth(expiresAt.getMonth() + 1);

    const { data: existing } = await supabase
      .from("checkup_subscriptions").select("id, expires_at")
      .eq("user_id", userId).eq("plan_id", checkupPlanId).eq("status", "active").maybeSingle();

    let subscriptionId: string | null = existing?.id ?? null;
    if (existing) {
      const baseExpiry = existing.expires_at ? new Date(existing.expires_at) : now;
      const start = baseExpiry.getTime() > now.getTime() ? baseExpiry : now;
      const newExpiry = new Date(start);
      if (billingCycle === "yearly") newExpiry.setFullYear(newExpiry.getFullYear() + 1);
      else newExpiry.setMonth(newExpiry.getMonth() + 1);
      const { error: renewErr } = await supabase
        .from("checkup_subscriptions")
        .update({ expires_at: newExpiry.toISOString(), status: "active" })
        .eq("id", existing.id);
      if (renewErr) log.error("renewal_extend_error", { message: renewErr.message });
    } else {
      // S3 race guard: defensive expire-first so concurrent callbacks don't trip the partial unique index.
      await supabase
        .from("checkup_subscriptions")
        .update({ status: "expired" })
        .eq("user_id", userId).eq("plan_id", checkupPlanId).eq("status", "active");

      const { data: sub, error } = await supabase
        .from("checkup_subscriptions").insert({
          user_id: userId,
          plan_id: checkupPlanId,
          billing_cycle: billingCycle,
          status: "active",
          started_at: now.toISOString(),
          expires_at: expiresAt.toISOString(),
          provider_id: provider?.id ?? null,
        }).select("id").single();
      if (error) {
        // If a concurrent callback already inserted the row, treat as success (renewal handled by the winner).
        if (String(error.message || "").includes("uq_checkup_sub_active_user_plan")) {
          log.info("checkup_subscriptions_race_winner_other", { userId, checkupPlanId });
          return new Response("1|OK", { status: 200 });
        }
        log.error("checkup_subscriptions_insert_error", { message: error.message });
        return new Response("0|Error", { status: 200 });
      }
      subscriptionId = sub.id;
    }

    const tradeNo = params.MerchantTradeNo;
    const { data: intent } = await supabase
      .from("payment_intents")
      .select("original_amount, discount_amount, discount_reason, attribution")
      .eq("trade_no", tradeNo).maybeSingle();

    // W4-2: 標記 payment_intent 為已完成（用於棄單回收判定）
    await supabase.from("payment_intents")
      .update({ status: "completed", completed_at: now.toISOString() })
      .eq("trade_no", tradeNo);

    const { data: tx } = await supabase.from("payment_transactions").insert({
      amount: tradeAmt,
      original_amount: intent?.original_amount ?? tradeAmt,
      discount_amount: intent?.discount_amount ?? 0,
      discount_reason: intent?.discount_reason ?? null,
      attribution: intent?.attribution ?? null,
      currency: "TWD",
      status: "paid",
      paid_at: now.toISOString(),
      provider_id: provider?.id ?? null,
      provider_tx_id: txId,
      subscription_id: null,
    }).select("id").single();

    if (tx) {
      try {
        await writeRevenueSplit(supabase, {
          transactionId: tx.id,
          planId: null, expertId: null,
          productKind: "checkup",
          gross: intent?.original_amount ?? tradeAmt,
          discount: intent?.discount_amount ?? 0,
          discountReason: intent?.discount_reason ?? null,
          attribution: intent?.attribution ?? null,
        });
      } catch (e) {
        log.error("revenue_split_failed", { message: (e as Error).message });
      }
    }

    void subscriptionId;
    return new Response("1|OK", { status: 200 });
  } catch (error) {
    log.error("uncaught", { message: (error as Error).message });
    return new Response("0|Error", { status: 200 });
  }
});

Deno.serve(handler);
