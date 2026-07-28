// AUTH: user  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { jsonResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabaseClients.ts";
import { withLogging } from "../_shared/edgeLogger.ts";
import { validateExpertOrderAmount } from "../_shared/orderAmountValidator.ts";
import { validateInput, validationJsonResponse } from "../_shared/inputValidator.ts";
import { createSubscriptionAndTransaction, recordPaymentForExistingSubscription, renewExistingSubscription } from "../_shared/paymentProcessor.ts";

async function generateSign(params: Record<string, string>, merchantKey: string): Promise<string> {
  const filtered = Object.entries(params)
    .filter(([k, v]) => k !== "sign" && v !== "" && v !== undefined && v !== null)
    .sort(([a], [b]) => a.localeCompare(b));
  const str = filtered.map(([k, v]) => `${k}=${v}`).join("&") + `&key=${merchantKey}`;
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function buildXml(_tag: string, params: Record<string, string>): string {
  const inner = Object.entries(params).map(([k, v]) => `<${k}>${v}</${k}>`).join("");
  return `<xml>${inner}</xml>`;
}

function parseXml(xml: string): Record<string, string> {
  const result: Record<string, string> = {};
  const regex = /<(\w+)><!\[CDATA\[(.*?)\]\]><\/\1>|<(\w+)>(.*?)<\/\3>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const key = match[1] || match[3];
    const value = match[2] || match[4];
    if (key && value !== undefined) result[key] = value;
  }
  return result;
}

function generateOutTradeNo(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `AC${ts}${rand}`.slice(0, 20);
}

const handler = withLogging("create-acpay-order", async (req, log) => {
  const body = await req.json();
  const {
    prime, amount, phone, countryCode, cardHolderName, cardHolderEmail,
    planId, billingCycle, userId, origin, slug, planName, expertName,
    originalAmount, discountAmount, discountReason, attribution, expertId,
    upgradeFromSubscriptionId,
  } = body;

  const issues = validateInput({
    fields: {
      prime: { required: true, type: 'string', minLength: 1, label: 'prime' },
      amount: { required: true, type: 'number', acceptTypes: ['string'], label: 'amount' },
      planId: { required: true, type: 'string', label: 'planId' },
      billingCycle: { required: true, type: 'string', oneOf: ['monthly', 'yearly'], label: 'billingCycle' },
    },
    source: body,
  });
  if (issues.length) return validationJsonResponse(issues);

  const merchantNo = Deno.env.get("ACPAY_MERCHANT_NO")!;
  const merchantKey = Deno.env.get("ACPAY_MERCHANT_KEY")!;
  const apiRoot = Deno.env.get("ACPAY_API_ROOT") || "https://aiodir.payloop.com.tw";
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const outTradeNo = generateOutTradeNo();
  const nonceStr = crypto.randomUUID().replace(/-/g, "").slice(0, 32);
  const supabase = serviceClient();

  const validation = await validateExpertOrderAmount({
    supabase,
    userId: userId ?? null,
    planId,
    billingCycle,
    clientAmount: Number(amount),
    upgradeFromSubscriptionId: upgradeFromSubscriptionId ?? null,
  });
  if (!validation.ok) {
    log.error("amount_validation_failed", { reason: validation.reason, planId, userId });
    return jsonResponse({ error: validation.reason || "金額不符" }, { status: 400 });
  }



  try {
    await supabase.from("payment_intents").insert({
      trade_no: outTradeNo,
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

  const callbackUrl = `${origin}/app/checkout/${slug}/${planId}?acpay=result&billingCycle=${billingCycle}`;
  const notifyUrl = `${supabaseUrl}/functions/v1/acpay-notify`;
  const itemName = `${expertName || "方案"} - ${planName || "訂閱"} (${billingCycle === "yearly" ? "年繳" : "月繳"})`;

  const params: Record<string, string> = {
    service: "vmj", version: "2.0", charset: "UTF-8", sign_type: "SHA256",
    merchant_no: merchantNo,
    out_trade_no: outTradeNo,
    nonce_str: nonceStr,
    body: itemName,
    total_fee: String(amount),
    mch_create_ip: "127.0.0.1",
    notify_url: notifyUrl,
    callback_url: callbackUrl,
    prime,
    card_holder_phone_number: (phone || "").replace(/^0/, ""),
    country_code: countryCode || "886",
    card_holder_name: cardHolderName || "",
    card_holder_email: cardHolderEmail || "",
    three_domain_secure: "Y",
    trade_mode: "0",
    attach: JSON.stringify({
      plan_id: planId, billing_cycle: billingCycle,
      user_id: userId || "", slug: slug || "",
    }),
  };

  params.sign = await generateSign(params, merchantKey);

  const xmlBody = buildXml("xml", params);
  const aioResponse = await fetch(apiRoot, {
    method: "POST",
    headers: { "Content-Type": "application/xml" },
    body: xmlBody,
  });

  const responseText = await aioResponse.text();
  const result = parseXml(responseText);
  const status = result.status;

  if (result.sign) {
    const expectedSign = await generateSign(result, merchantKey);
    if (expectedSign !== result.sign) {
      log.error("response_sign_failed");
      return jsonResponse({ error: "Sign verification failed" }, { status: 400 });
    }
  }

  if (status !== "0") {
    const errMsg = result.message || result.err_msg || "Payment failed";
    log.error("acpay_error", { errMsg });
    if (userId && planId) {
      try {
        await fetch(`${supabaseUrl}/functions/v1/notify-payment-failure`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
          body: JSON.stringify({
            userId, planId, amount, provider: "acpay",
            errorDetail: `status: ${status}, msg: ${errMsg}`,
          }),
        });
      } catch (e) { log.error("notify_failure_failed", { message: (e as Error).message }); }
    }
    return jsonResponse({ error: errMsg, status }, { status: 400 });
  }

  if (result.code_url) {
    return jsonResponse({ threeDS: true, codeUrl: result.code_url, outTradeNo });
  }

  const payResult = result.pay_result;
  if (payResult === "0") {
    const { data: provider } = await supabase
      .from("payment_providers").select("id")
      .eq("provider_type", "acpay").eq("is_active", true).single();

    const now = new Date();

    let subscriptionId: string | null = null;
    if (userId && planId) {
      const { data: existing } = await supabase
        .from("member_subscriptions").select("id, expires_at")
        .eq("user_id", userId).eq("plan_id", planId).eq("status", "active");

      if (existing && existing.length > 0) {
        subscriptionId = existing[0].id;
        const renewResult = await renewExistingSubscription(supabase, {
          subscriptionId, billingCycle, now,
        });
        if (renewResult.error) log.error("renewal_extend_error", { error: String(renewResult.error) });
        const { error: txError } = await recordPaymentForExistingSubscription(supabase, {
          subscriptionId, amount, currency: "TWD",
          providerTxId: result.transaction_id || outTradeNo,
          providerId: provider?.id || null,
          now,
          originalAmount: originalAmount ?? amount,
          discountAmount: discountAmount ?? 0,
          discountReason: discountReason ?? null,
          attribution: attribution ?? null,
          productKind: "expert_plan",
          planId,
          expertId: validation.expertId ?? expertId ?? null,
        });
        if (txError) log.error("tx_insert_error", { message: String(txError) });
      } else {
        const createResult = await createSubscriptionAndTransaction(supabase, {
          userId, planId, billingCycle, amount, currency: "TWD",
          providerTxId: result.transaction_id || outTradeNo,
          providerId: provider?.id || null,
          now,
          originalAmount: originalAmount ?? amount,
          discountAmount: discountAmount ?? 0,
          discountReason: discountReason ?? null,
          attribution: attribution ?? null,
          productKind: "expert_plan",
          expertId: validation.expertId ?? expertId ?? null,
        });
        if (createResult.error) log.error("create_sub_tx_failed", { error: String(createResult.error) });
        subscriptionId = createResult.subscriptionId;
      }
    }

    return jsonResponse({ success: true, subscriptionId });
  }

  return jsonResponse({ error: "Payment failed", payResult }, { status: 400 });
});

Deno.serve(handler);
