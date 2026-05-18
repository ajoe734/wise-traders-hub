import { jsonResponse } from "../_shared/cors.ts";
import { serviceClient, userClient } from "../_shared/supabaseClients.ts";
import { withLogging } from "../_shared/edgeLogger.ts";

const handler = withLogging("create-checkup-remittance", async (req, log) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Unauthorized" }, { status: 401 });

  const supabase = userClient(req);
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return jsonResponse({ error: "Unauthorized" }, { status: 401 });
  const userId = userData.user.id;

  const { checkupPlanId, billingCycle, originalAmount, discountAmount, discountReason, attribution } = await req.json();
  if (!checkupPlanId || !billingCycle) return jsonResponse({ error: "Missing required fields" }, { status: 400 });

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
