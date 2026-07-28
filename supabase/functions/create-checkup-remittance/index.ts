// AUTH: user  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { jsonResponse } from "../_shared/cors.ts";
import { codedErrorResponse } from "../_shared/errorCodes.ts";
import { serviceClient, userClient } from "../_shared/supabaseClients.ts";
import { withLogging } from "../_shared/edgeLogger.ts";
import { validateInput, validationJsonResponse } from "../_shared/inputValidator.ts";

const handler = withLogging("create-checkup-remittance", async (req, log) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return codedErrorResponse("AUTH_REQUIRED", "請先登入");

  const supabase = userClient(req);
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return codedErrorResponse("AUTH_FAILED", "登入狀態無效");
  const userId = userData.user.id;

  const body = await req.json();
  const { checkupPlanId, billingCycle, originalAmount, discountAmount, discountReason, attribution } = body;
  const issues = validateInput({
    fields: {
      checkupPlanId: { required: true, type: 'string', label: 'checkupPlanId' },
      billingCycle: { required: true, type: 'string', oneOf: ['monthly', 'yearly'], label: 'billingCycle' },
    },
    source: body,
  });
  if (issues.length) return validationJsonResponse(issues);

  const admin = serviceClient();
  const { data: plan } = await admin.from("checkup_plans")
    .select("price_monthly, price_yearly, is_active")
    .eq("id", checkupPlanId).maybeSingle();
  if (!plan || !plan.is_active) return jsonResponse({ error: "Plan not found" }, { status: 404 });
  const basePrice = billingCycle === "yearly" ? plan.price_yearly : plan.price_monthly;

  const original = Number.isFinite(Number(originalAmount)) && Number(originalAmount) > 0
    ? Math.round(Number(originalAmount)) : basePrice;
  const discount = Number.isFinite(Number(discountAmount)) && Number(discountAmount) > 0
    ? Math.min(Math.round(Number(discountAmount)), original) : 0;
  const amount = Math.max(0, original - discount);

  const { data, error } = await admin.from("remittance_orders").insert({
    user_id: userId,
    product_kind: "checkup_plan",
    checkup_plan_id: checkupPlanId,
    plan_id: null,
    billing_cycle: billingCycle,
    amount,
    original_amount: original,
    discount_amount: discount,
    discount_reason: discount > 0 ? (discountReason ?? null) : null,
    attribution: attribution ?? null,
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
