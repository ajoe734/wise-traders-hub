import { jsonResponse } from "../_shared/cors.ts";
import { codedErrorResponse } from "../_shared/errorCodes.ts";
import { serviceClient, userClient } from "../_shared/supabaseClients.ts";
import { withLogging } from "../_shared/edgeLogger.ts";

const handler = withLogging("create-expert-remittance", async (req, log) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return codedErrorResponse("AUTH_REQUIRED", "請先登入");

  const supabase = userClient(req);
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return codedErrorResponse("AUTH_FAILED", "登入狀態無效");
  const userId = userData.user.id;

  const {
    planId,
    billingCycle,
    originalAmount,
    discountAmount,
    discountReason,
    attribution,
    upgradeFromSubscriptionId,
  } = await req.json();

  if (!planId || !billingCycle) {
    return codedErrorResponse("INVALID_INPUT", "缺少必填欄位：planId / billingCycle");
  }
  if (billingCycle !== "monthly" && billingCycle !== "yearly") {
    return codedErrorResponse("INVALID_INPUT", "billingCycle 必須為 monthly 或 yearly");
  }

  const admin = serviceClient();
  const { data: plan } = await admin
    .from("expert_plans")
    .select("id, price_monthly, price_yearly, is_active, review_status, expert_id")
    .eq("id", planId)
    .maybeSingle();

  if (!plan || !plan.is_active || plan.review_status !== "approved") {
    return jsonResponse({ error: "Plan not found or not available" }, { status: 404 });
  }

  const basePrice = billingCycle === "yearly" ? plan.price_yearly : plan.price_monthly;
  if (!basePrice || basePrice <= 0) {
    return jsonResponse({ error: "Plan price is invalid" }, { status: 400 });
  }

  const original = Number.isFinite(Number(originalAmount)) && Number(originalAmount) > 0
    ? Math.round(Number(originalAmount))
    : basePrice;
  const discount = Number.isFinite(Number(discountAmount)) && Number(discountAmount) > 0
    ? Math.min(Math.round(Number(discountAmount)), original)
    : 0;
  const amount = Math.max(0, original - discount);

  const { data, error } = await admin.from("remittance_orders").insert({
    user_id: userId,
    product_kind: "expert_plan",
    plan_id: planId,
    checkup_plan_id: null,
    billing_cycle: billingCycle,
    amount,
    original_amount: original,
    discount_amount: discount,
    discount_reason: discount > 0 ? (discountReason ?? null) : null,
    attribution: attribution ?? null,
    upgrade_from_subscription_id: upgradeFromSubscriptionId ?? null,
    last5: null,
    payer_name: null,
    status: "awaiting_info",
  }).select("id").single();

  if (error) {
    log.error("remittance_insert_error", { message: error.message });
    return jsonResponse({ error: error.message }, { status: 500 });
  }
  return jsonResponse({ orderId: data.id, amount });
});

Deno.serve(handler);
