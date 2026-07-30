// AUTH: user  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { jsonResponse } from "../_shared/cors.ts";
import { requireCompanyAdmin, authErrorResponse } from "../_shared/adminGuard.ts";
import { serviceClient } from "../_shared/supabaseClients.ts";
import { withLogging } from "../_shared/edgeLogger.ts";
import { writeRevenueSplit } from "../_shared/paymentProcessor.ts";
import { validateInput, validationJsonResponse } from "../_shared/inputValidator.ts";

const handler = withLogging("confirm-remittance", async (req, log) => {
  // AUTH: company_admin (unified contract — see _shared/adminGuard.ts)
  try {
    await requireCompanyAdmin(req);
  } catch (e) {
    return authErrorResponse(e, req);
  }

  const body = await req.json();
  const issues = validateInput({
    fields: { orderId: { required: true, type: 'string', label: 'orderId' } },
    source: body,
  });
  if (issues.length) return validationJsonResponse(issues);
  const { orderId } = body;

  const admin = serviceClient();
  const { data: order, error: oerr } = await admin.from("remittance_orders").select("*").eq("id", orderId).maybeSingle();
  if (oerr || !order) return jsonResponse({ error: "Order not found" }, { status: 404 });
  if (order.status !== "pending") return jsonResponse({ error: "Order is not pending" }, { status: 400 });

  const isCheckup = order.product_kind === "checkup_plan";
  const subTable = isCheckup ? "checkup_subscriptions" : "member_subscriptions";
  const planFK = isCheckup ? order.checkup_plan_id : order.plan_id;

  const cycleMs = order.billing_cycle === "yearly" ? 365 * 86400000 : 30 * 86400000;
  const now = new Date();

  const { data: existing } = await admin
    .from(subTable).select("id, expires_at")
    .eq("user_id", order.user_id).eq("plan_id", planFK)
    .eq("status", "active").maybeSingle();

  let subscriptionId: string;
  if (existing) {
    const baseExpire = existing.expires_at ? new Date(existing.expires_at).getTime() : now.getTime();
    const newExpire = new Date(Math.max(baseExpire, now.getTime()) + cycleMs);
    const { error: uerr } = await admin.from(subTable)
      .update({ expires_at: newExpire.toISOString() }).eq("id", existing.id);
    if (uerr) return jsonResponse({ error: uerr.message }, { status: 500 });
    subscriptionId = existing.id;
  } else {
    const expires = new Date(now.getTime() + cycleMs);
    const insertPayload: any = {
      user_id: order.user_id,
      plan_id: planFK,
      status: "active",
      started_at: now.toISOString(),
      expires_at: expires.toISOString(),
      auto_renew: false,
      billing_cycle: order.billing_cycle === "yearly" ? "yearly" : "monthly",
    };
    const { data: sub, error: serr } = await admin.from(subTable).insert(insertPayload).select("id").single();
    if (serr) return jsonResponse({ error: serr.message }, { status: 500 });
    subscriptionId = sub.id;
  }

  const { data: provider } = await admin
    .from("payment_providers").select("id")
    .eq("provider_type", "remittance").eq("is_active", true).maybeSingle();

  const txPayload: any = {
    amount: order.amount,
    original_amount: order.original_amount ?? order.amount,
    discount_amount: order.discount_amount ?? 0,
    discount_reason: order.discount_reason ?? null,
    attribution: order.attribution ?? null,
    currency: "TWD",
    status: "paid",
    paid_at: now.toISOString(),
    provider_id: provider?.id ?? null,
    provider_tx_id: `REMIT:${order.id}`,
    subscription_id: isCheckup ? null : subscriptionId,
  };
  const { data: tx, error: txErr } = await admin.from("payment_transactions").insert(txPayload).select("id").single();
  if (txErr) log.error("payment_transactions_insert_error", { message: txErr.message });

  let expertId: string | null = null;
  if (!isCheckup && planFK) {
    const { data: planRow } = await admin.from("expert_plans").select("expert_id").eq("id", planFK).maybeSingle();
    expertId = planRow?.expert_id ?? null;
  }

  if (tx) {
    try {
      await writeRevenueSplit(admin, {
        transactionId: tx.id,
        planId: isCheckup ? null : planFK,
        expertId,
        productKind: isCheckup ? "checkup" : "expert_plan",
        gross: order.original_amount ?? order.amount,
        discount: order.discount_amount ?? 0,
        discountReason: order.discount_reason ?? null,
        attribution: (order.attribution as any) ?? null,
      });
    } catch (e) {
      log.error("writeRevenueSplit_failed", { message: (e as Error).message });
    }
  }

  await admin.from("remittance_orders").update({
    status: "confirmed",
    confirmed_at: now.toISOString(),
    confirmed_by: u.user.id,
    subscription_id: subscriptionId,
  }).eq("id", orderId);

  await admin.from("audit_logs").insert({
    actor_id: u.user.id,
    action: "remittance.confirm",
    target_type: "remittance_orders",
    target_id: orderId,
    detail: { subscriptionId, amount: order.amount, product_kind: order.product_kind, transaction_id: tx?.id ?? null },
  });

  return jsonResponse({ ok: true, subscriptionId, transactionId: tx?.id ?? null });
});

Deno.serve(handler);
