// AUTH: user  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { jsonResponse } from "../_shared/cors.ts";
import { requireCaller, AuthError } from '../_shared/authGuard.ts';
import { serviceClient } from "../_shared/supabaseClients.ts";
import { withLogging } from "../_shared/edgeLogger.ts";
import { validateExpertOrderAmount } from "../_shared/orderAmountValidator.ts";
import { validateInput, validationJsonResponse } from "../_shared/inputValidator.ts";

async function hmacSha256Base64(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

const handler = withLogging("create-linepay-order", async (req, log) => {
  // AUTH: user (Phase M-2 runtime enforcement)
  if (req.method !== 'OPTIONS') {
    try { await requireCaller(req); }
    catch (e) {
      if (e instanceof AuthError) {
        return new Response(JSON.stringify({ error: e.message, code: e.code }), {
          status: e.status,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      throw e;
    }
  }

  const body = await req.json();
  const {
    planId, billingCycle, slug, amount, planName, expertName, origin,
    userId, originalAmount, discountAmount, discountReason, attribution, expertId,
    upgradeFromSubscriptionId,
  } = body;

  const issues = validateInput({
    fields: {
      planId: { required: true, type: 'string', label: 'planId' },
      billingCycle: { required: true, type: 'string', oneOf: ['monthly', 'yearly'], label: 'billingCycle' },
      slug: { required: true, type: 'string', label: 'slug' },
      amount: { required: true, type: 'number', acceptTypes: ['string'], label: 'amount' },
      origin: { required: true, type: 'string', label: 'origin' },
    },
    source: body,
  });
  if (issues.length) return validationJsonResponse(issues);

  const sbAdmin = serviceClient();
  const amt = Number(amount);
  const validation = await validateExpertOrderAmount({
    supabase: sbAdmin,
    userId: userId ?? null,
    planId,
    billingCycle,
    clientAmount: amt,
    upgradeFromSubscriptionId: upgradeFromSubscriptionId ?? null,
  });
  if (!validation.ok) {
    log.error("amount_validation_failed", { reason: validation.reason, planId, userId });
    return jsonResponse({ error: validation.reason || "金額不符" }, { status: 400 });
  }



  const channelId = Deno.env.get("LINEPAY_CHANNEL_ID")!;
  const channelSecret = Deno.env.get("LINEPAY_CHANNEL_SECRET")!;
  const isSimulate = (Deno.env.get("LINEPAY_SIMULATE") || "true") === "true";

  const orderId = `ORDER-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const nonce = crypto.randomUUID();

  try {
    await sbAdmin.from("payment_intents").insert({
      trade_no: orderId,
      user_id: userId || null,
      product_kind: "expert_plan",
      plan_id: planId,
      expert_id: expertId || null,
      billing_cycle: billingCycle,
      original_amount: originalAmount ?? amount,
      discount_amount: discountAmount ?? 0,
      discount_reason: discountReason ?? null,
      amount,
      attribution: attribution ?? null,
      upgrade_from_subscription_id: upgradeFromSubscriptionId ?? null,
    });
  } catch (e) { log.error("payment_intents_insert_failed", { message: (e as Error).message }); }

  const requestBody = {
    amount, currency: "TWD", orderId,
    packages: [{
      id: planId, amount, name: expertName || "訂閱方案",
      products: [{ name: planName || "訂閱方案", quantity: 1, price: amount }],
    }],
    redirectUrls: {
      confirmUrl: `${origin}/app/checkout/${slug}/${planId}?linepay=confirm&billingCycle=${billingCycle}&simulate=${isSimulate}`,
      cancelUrl: `${origin}/app/checkout/${slug}/${planId}?linepay=cancel`,
    },
  };

  const linepayApiUrl = Deno.env.get("LINEPAY_API_URL") || "https://sandbox-api-pay.line.me";
  const apiUri = "/v3/payments/request";
  const bodyStr = JSON.stringify(requestBody);
  const signatureMessage = channelSecret + apiUri + bodyStr + nonce;
  const signature = await hmacSha256Base64(channelSecret, signatureMessage);

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
    log.error("linepay_request_failed", { returnCode: result.returnCode });
    return jsonResponse({ error: result.returnMessage || "LINE Pay error" }, { status: 400 });
  }

  return jsonResponse({
    paymentUrl: result.info.paymentUrl.web,
    transactionId: result.info.transactionId,
    orderId,
  });
});

Deno.serve(handler);
