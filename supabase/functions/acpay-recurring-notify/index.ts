// AUTH: webhook-signature  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { serviceClient } from "../_shared/supabaseClients.ts";
import { withLogging } from "../_shared/edgeLogger.ts";
import { acpayDeriveKeyAndIv as deriveKeyAndIv, acpayAesDecrypt as aesDecrypt, acpayRecurringExtractTxId, isDuplicatePaymentTx } from "../_shared/paymentVerify.ts";
import { extendSubscriptionExpiry } from "../_shared/subscriptionRenewal.ts";

// ACREC periodic billing notification handler
// Must return { err_code: "0", err_msg: "成功" }
const handler = withLogging("acpay-recurring-notify", async (req, log) => {
  const okResp = () => new Response(JSON.stringify({ err_code: "0", err_msg: "成功" }), {
    headers: { "Content-Type": "application/json" },
  });
  try {
    const body = await req.json();
    const merchantKey = Deno.env.get("ACPAY_MERCHANT_KEY")!;
    const nonceStr = body.nonce_str || "";
    const encryptedData = body.data || "";

    if (!nonceStr || !encryptedData) {
      log.error("missing_fields");
      return new Response(JSON.stringify({ err_code: "1", err_msg: "Missing fields" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const { key, iv } = deriveKeyAndIv(merchantKey, nonceStr);
    const decryptedStr = await aesDecrypt(encryptedData, key, iv);
    const payload = JSON.parse(decryptedStr);
    const order = payload.order || payload;

    const payResult = String(order.currentPeriodPayResult ?? order.pay_result ?? "");
    const outTradeNo = order.out_trade_no || order.outTradeNo || "";
    const totalFee = parseInt(order.total_fee || order.totalFee || "0", 10);
    const transactionId = acpayRecurringExtractTxId(order);

    let metadata: any = {};
    try { metadata = JSON.parse(order.attach || "{}"); } catch {}
    const planId = metadata.plan_id || order.plan_id || "";
    const billingCycle = metadata.billing_cycle || order.billing_cycle || "monthly";
    const userId = metadata.user_id || order.user_id || "";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = serviceClient();

    if (payResult !== "0") {
      log.info("recurring_payment_failed", { payResult });
      if (userId && planId) {
        try {
          await fetch(`${supabaseUrl}/functions/v1/notify-payment-failure`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
            body: JSON.stringify({
              userId, planId, amount: totalFee, provider: "acpay",
              errorDetail: `recurring payResult: ${payResult}`,
            }),
          });
        } catch (e) { log.error("notify_failure_failed", { message: (e as Error).message }); }
      }
      return okResp();
    }

    const { data: provider } = await supabase
      .from("payment_providers").select("id")
      .eq("provider_type", "acpay").eq("is_active", true).single();

    if (await isDuplicatePaymentTx(supabase, transactionId)) {
      log.info("duplicate", { transactionId });
      return okResp();
    }

    let subscriptionId: string | null = null;
    if (userId && planId) {
      const result = await extendSubscriptionExpiry(supabase, { userId, planId, billingCycle, now: new Date() });
      if (result.error) log.error("extend_error", { error: String(result.error) });
      else subscriptionId = result.subscriptionId;
    }

    const { error: txError } = await supabase.from("payment_transactions").insert({
      amount: totalFee, currency: "TWD", status: "paid",
      paid_at: new Date().toISOString(),
      provider_id: provider?.id || null,
      provider_tx_id: transactionId,
      subscription_id: subscriptionId,
    });
    if (txError) log.error("tx_insert_error", { message: txError.message });

    void outTradeNo;
    return okResp();
  } catch (error) {
    log.error("uncaught", { message: (error as Error).message });
    return new Response(JSON.stringify({ err_code: "1", err_msg: (error as Error).message }), {
      headers: { "Content-Type": "application/json" },
    });
  }
});

Deno.serve(handler);
