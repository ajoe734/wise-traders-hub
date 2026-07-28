// AUTH: user  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { jsonResponse } from "../_shared/cors.ts";
import { codedErrorResponse } from "../_shared/errorCodes.ts";
import { serviceClient, userClient } from "../_shared/supabaseClients.ts";
import { withLogging } from "../_shared/edgeLogger.ts";
import { validateInput, validationJsonResponse } from "../_shared/inputValidator.ts";

const handler = withLogging("create-expert-remittance", async (req, log) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return codedErrorResponse("AUTH_REQUIRED", "請先登入");

  const supabase = userClient(req);
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return codedErrorResponse("AUTH_FAILED", "登入狀態無效");
  const userId = userData.user.id;

  const body = await req.json();
  const {
    planId,
    billingCycle,
    originalAmount,
    discountAmount,
    discountReason,
    attribution,
    upgradeFromSubscriptionId,
    clientRequestId,
  } = body;

  const issues = validateInput({
    fields: {
      planId: { required: true, type: 'string', label: 'planId' },
      billingCycle: { required: true, type: 'string', oneOf: ['monthly', 'yearly'], label: 'billingCycle' },
    },
    source: body,
  });
  if (issues.length) return validationJsonResponse(issues);

  const admin = serviceClient();

  // ── Idempotency 1: same clientRequestId → return existing order
  if (clientRequestId && typeof clientRequestId === "string") {
    const { data: existingByReq } = await admin
      .from("remittance_orders")
      .select("id, amount")
      .eq("user_id", userId)
      .eq("client_request_id", clientRequestId)
      .maybeSingle();
    if (existingByReq) {
      return jsonResponse({ orderId: existingByReq.id, amount: existingByReq.amount, reused: true });
    }
  }

  // ── Idempotency 2: existing unfinished order for same plan/cycle → reuse
  const { data: existingOpen } = await admin
    .from("remittance_orders")
    .select("id, amount")
    .eq("user_id", userId)
    .eq("plan_id", planId)
    .eq("billing_cycle", billingCycle)
    .in("status", ["awaiting_info", "pending"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingOpen) {
    return jsonResponse({ orderId: existingOpen.id, amount: existingOpen.amount, reused: true });
  }

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

  const attributionPayload = {
    ...(attribution && typeof attribution === "object" ? attribution : {}),
    ...(upgradeFromSubscriptionId ? { upgrade_from_subscription_id: upgradeFromSubscriptionId } : {}),
  };

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
    attribution: Object.keys(attributionPayload).length > 0 ? attributionPayload : null,
    last5: null,
    payer_name: null,
    status: "awaiting_info",
    client_request_id: clientRequestId ?? null,
  }).select("id").single();

  if (error) {
    // Unique-violation race: another concurrent insert won — re-read & return it
    if ((error as any).code === "23505" && clientRequestId) {
      const { data: raceWinner } = await admin
        .from("remittance_orders")
        .select("id, amount")
        .eq("user_id", userId)
        .eq("client_request_id", clientRequestId)
        .maybeSingle();
      if (raceWinner) {
        return jsonResponse({ orderId: raceWinner.id, amount: raceWinner.amount, reused: true });
      }
    }
    log.error("remittance_insert_error", { message: error.message });
    return jsonResponse({ error: error.message }, { status: 500 });
  }
  return jsonResponse({ orderId: data.id, amount });
});

Deno.serve(handler);
