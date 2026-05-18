import { jsonResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabaseClients.ts";
import { withLogging } from "../_shared/edgeLogger.ts";
import { loadEcpayCreds } from "../_shared/ecpayCredentials.ts";

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

const handler = withLogging("create-checkup-ecpay-order", async (req, log) => {
  const body = await req.json();
  const { checkupPlanId, billingCycle, amount, planName, origin, userId,
    originalAmount, discountAmount, discountReason, attribution } = body;

  if (!checkupPlanId || !billingCycle || !amount || !origin || !userId) {
    return jsonResponse({ error: "Missing required fields" }, { status: 400 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabase = serviceClient();
  const { data: plan } = await supabase
    .from("checkup_plans").select("price_monthly, price_yearly, is_active")
    .eq("id", checkupPlanId).maybeSingle();
  if (!plan || !plan.is_active) return jsonResponse({ error: "Plan not found" }, { status: 404 });

  const expected = billingCycle === "yearly" ? plan.price_yearly : plan.price_monthly;
  const expectedFinal = Number(expected) - Number(discountAmount || 0);
  if (Number(amount) !== expectedFinal) {
    return jsonResponse({ error: "Amount mismatch" }, { status: 400 });
  }

  const creds = await loadEcpayCreds(supabase);

  const tradeNo = `CK${Date.now().toString().slice(-13)}`;
  const now = new Date();
  const tradeDate = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

  const returnUrl = `${origin}/checkout/checkup/${checkupPlanId}?ecpay=result&billingCycle=${billingCycle}`;
  const notifyUrl = `${supabaseUrl}/functions/v1/checkup-ecpay-callback`;

  const itemName = `${planName} (${billingCycle === "yearly" ? "年繳" : "月繳"})`;

  const params: Record<string, string> = {
    MerchantID: creds.merchantId,
    MerchantTradeNo: tradeNo,
    MerchantTradeDate: tradeDate,
    PaymentType: "aio",
    TotalAmount: String(amount),
    TradeDesc: "Checkup Subscription",
    ItemName: itemName,
    ReturnURL: notifyUrl,
    ClientBackURL: returnUrl,
    ChoosePayment: "Credit",
    EncryptType: "1",
    CustomField1: `CK:${checkupPlanId}`,
    CustomField2: billingCycle,
    CustomField3: "checkup",
    CustomField4: userId,
  };

  params.CheckMacValue = await generateCheckMacValueAsync(params, creds.hashKey, creds.hashIV);

  try {
    await supabase.from("payment_intents").insert({
      trade_no: tradeNo,
      user_id: userId,
      product_kind: "checkup",
      checkup_plan_id: checkupPlanId,
      billing_cycle: billingCycle,
      original_amount: originalAmount ?? expected,
      discount_amount: discountAmount ?? 0,
      discount_reason: discountReason ?? null,
      amount,
      attribution: attribution ?? null,
    });
  } catch (e) {
    log.error("payment_intents_insert_failed", { message: (e as Error).message });
  }

  return jsonResponse({ actionUrl: creds.creditActionUrl, params });
});

Deno.serve(handler);
