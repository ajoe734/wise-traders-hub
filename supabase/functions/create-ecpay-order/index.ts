// AUTH: user  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { jsonResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabaseClients.ts";
import { withLogging } from "../_shared/edgeLogger.ts";
import { loadEcpayCreds } from "../_shared/ecpayCredentials.ts";
import { validateExpertOrderAmount } from "../_shared/orderAmountValidator.ts";
import { validateInput, validationJsonResponse } from "../_shared/inputValidator.ts";

async function generateCheckMacValueAsync(
  params: Record<string, string>, hashKey: string, hashIV: string,
): Promise<string> {
  const sorted = Object.keys(params)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((key) => `${key}=${params[key]}`).join("&");
  const raw = `HashKey=${hashKey}&${sorted}&HashIV=${hashIV}`;
  let encoded = encodeURIComponent(raw).toLowerCase();
  encoded = encoded
    .replace(/%2d/g, "-").replace(/%5f/g, "_").replace(/%2e/g, ".")
    .replace(/%21/g, "!").replace(/%2a/g, "*").replace(/%28/g, "(")
    .replace(/%29/g, ")").replace(/%20/g, "+").replace(/%7e/g, "~");
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(encoded));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

const handler = withLogging("create-ecpay-order", async (req, log) => {
  const body = await req.json();
  const {
    planId, billingCycle, slug, amount, planName, expertName, origin, userId,
    originalAmount, discountAmount, discountReason, attribution, expertId,
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

  const credsClient = serviceClient();
  const validation = await validateExpertOrderAmount({
    supabase: credsClient,
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

  const creds = await loadEcpayCreds(credsClient);

  const tradeNo = `EC${Date.now().toString().slice(-13)}`;
  const now = new Date();
  const tradeDate = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const returnUrl = `${origin}/app/checkout/${slug}/${planId}?ecpay=result&billingCycle=${billingCycle}`;
  const notifyUrl = `${supabaseUrl}/functions/v1/ecpay-callback`;

  const itemName = `${expertName} - ${planName} (${billingCycle === "yearly" ? "年繳" : "月繳"})`;

  const params: Record<string, string> = {
    MerchantID: creds.merchantId,
    MerchantTradeNo: tradeNo,
    MerchantTradeDate: tradeDate,
    PaymentType: "aio",
    TotalAmount: String(amount),
    TradeDesc: "Subscription",
    ItemName: itemName,
    ReturnURL: notifyUrl,
    ClientBackURL: returnUrl,
    ChoosePayment: "Credit",
    EncryptType: "1",
    CustomField1: planId,
    CustomField2: billingCycle,
    CustomField3: slug,
    CustomField4: userId || "",
  };

  params.CheckMacValue = await generateCheckMacValueAsync(params, creds.hashKey, creds.hashIV);

  try {
    await credsClient.from("payment_intents").insert({
      trade_no: tradeNo,
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
  } catch (e) {
    log.error("payment_intents_insert_failed", { message: (e as Error).message });
  }

  return jsonResponse({ actionUrl: creds.creditActionUrl, params });
});

Deno.serve(handler);
