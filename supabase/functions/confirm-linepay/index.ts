// AUTH: webhook-signature  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { jsonResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabaseClients.ts";
import { withLogging } from "../_shared/edgeLogger.ts";
import { linepayHmacSha256Base64 as hmacSha256Base64 } from "../_shared/paymentVerify.ts";
import { createSubscriptionAndTransaction, recordPaymentForExistingSubscription, renewExistingSubscription } from "../_shared/paymentProcessor.ts";
import { validateInput, validationJsonResponse } from "../_shared/inputValidator.ts";

const handler = withLogging("confirm-linepay", async (req, log) => {
  const body = await req.json();
  const { transactionId, orderId, amount, planId, billingCycle, userId, simulate } = body;
  const issues = validateInput({
    fields: {
      transactionId: { required: true, type: 'string', label: 'transactionId' },
      orderId: { required: true, type: 'string', label: 'orderId' },
      amount: { required: true, type: 'number', acceptTypes: ['string'], label: 'amount' },
    },
    source: body,
  });
  if (issues.length) return validationJsonResponse(issues);

  const channelId = Deno.env.get("LINEPAY_CHANNEL_ID")!;
  const channelSecret = Deno.env.get("LINEPAY_CHANNEL_SECRET")!;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (!simulate) {
    const nonce = crypto.randomUUID();
    const confirmBody = { amount, currency: "TWD" };
    const apiUri = `/v3/payments/${transactionId}/confirm`;
    const bodyStr = JSON.stringify(confirmBody);
    const signatureMessage = channelSecret + apiUri + bodyStr + nonce;
    const signature = await hmacSha256Base64(channelSecret, signatureMessage);

    const linepayApiUrl = Deno.env.get("LINEPAY_API_URL") || "https://sandbox-api-pay.line.me";
    const response = await fetch(`${linepayApiUrl}${apiUri}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-LINE-ChannelId": channelId,
        "X-LINE-Authorization-Nonce": nonce,
        "X-LINE-Authorization": signature,
      },
      body: bodyStr,
    });
    const result = await response.json();

    if (result.returnCode !== "0000") {
      log.error("linepay_confirm_failed", { returnCode: result.returnCode, returnMessage: result.returnMessage });
      if (userId && planId) {
        try {
          await fetch(`${supabaseUrl}/functions/v1/notify-payment-failure`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceRoleKey}` },
            body: JSON.stringify({
              userId, planId, amount, provider: "line_pay",
              errorDetail: `returnCode: ${result.returnCode}, msg: ${result.returnMessage || ""}`,
            }),
          });
        } catch (e) { log.error("notify_failure_failed", { message: (e as Error).message }); }
      }
      return jsonResponse(
        { error: result.returnMessage || "Confirm failed", returnCode: result.returnCode },
        { status: 400 },
      );
    }
  }

  const supabase = serviceClient();

  const { data: provider } = await supabase
    .from("payment_providers").select("id")
    .eq("provider_type", "line_pay").eq("is_active", true).single();

  const now = new Date();

  // W4-2: 標記 payment_intent 為已完成（用於棄單回收判定）
  await supabase.from("payment_intents")
    .update({ status: "completed", completed_at: now.toISOString() })
    .eq("trade_no", String(orderId));

  let subscriptionId: string | null = null;
  if (userId && planId) {
    const { data: existing } = await supabase
      .from("member_subscriptions").select("id")
      .eq("user_id", userId).eq("plan_id", planId).eq("status", "active");

    if (existing && existing.length > 0) {
      const renewResult = await renewExistingSubscription(supabase, {
        subscriptionId: existing[0].id, billingCycle, now,
      });
      if (renewResult.error) log.error("renewal_extend_error", { error: String(renewResult.error) });
      const { error: txError } = await recordPaymentForExistingSubscription(supabase, {
        subscriptionId: existing[0].id, amount, currency: "TWD",
        providerTxId: String(transactionId), providerId: provider?.id || null, now,
      });
      if (txError) log.error("tx_insert_error", { message: String(txError) });
      return jsonResponse({
        success: true, subscriptionId: existing[0].id, renewed: true,
        newExpiresAt: renewResult.newExpiresAt,
      });
    }

    const result = await createSubscriptionAndTransaction(supabase, {
      userId, planId, billingCycle, amount, currency: "TWD",
      providerTxId: String(transactionId), providerId: provider?.id || null, now,
    });
    if (result.error) log.error("create_sub_tx_failed", { error: String(result.error) });
    else subscriptionId = result.subscriptionId;
  } else {
    const { error: txError } = await supabase.from("payment_transactions").insert({
      amount, currency: "TWD", status: "paid", paid_at: now.toISOString(),
      provider_id: provider?.id || null,
      provider_tx_id: String(transactionId), subscription_id: null,
    });
    if (txError) log.error("tx_insert_error", { message: txError.message });
  }

  return jsonResponse({ success: true, subscriptionId });
});

Deno.serve(handler);
