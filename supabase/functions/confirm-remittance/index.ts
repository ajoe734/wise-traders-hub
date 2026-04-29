import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { writeRevenueSplit } from "../_shared/paymentProcessor.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ error: "Unauthorized" }, 401);

    const { data: roleRow } = await userClient
      .from('user_roles').select('role').eq('user_id', u.user.id).eq('role', 'company_admin').maybeSingle();
    if (!roleRow) return json({ error: "Forbidden" }, 403);

    const { orderId } = await req.json();
    if (!orderId) return json({ error: "Missing orderId" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: order, error: oerr } = await admin.from("remittance_orders").select("*").eq("id", orderId).maybeSingle();
    if (oerr || !order) return json({ error: "Order not found" }, 404);
    if (order.status !== "pending") return json({ error: "Order is not pending" }, 400);

    const isCheckup = order.product_kind === "checkup_plan";
    const subTable = isCheckup ? "checkup_subscriptions" : "member_subscriptions";
    const planFK = isCheckup ? order.checkup_plan_id : order.plan_id;

    const cycleMs = order.billing_cycle === "yearly" ? 365 * 86400000 : 30 * 86400000;
    const now = new Date();

    // 已存在 active 訂閱 → 延長期限（升級/續約場景），不重建第二筆
    const { data: existing } = await admin
      .from(subTable)
      .select("id, expires_at")
      .eq("user_id", order.user_id)
      .eq("plan_id", planFK)
      .eq("status", "active")
      .maybeSingle();

    let subscriptionId: string;
    if (existing) {
      const baseExpire = existing.expires_at ? new Date(existing.expires_at).getTime() : now.getTime();
      const newExpire = new Date(Math.max(baseExpire, now.getTime()) + cycleMs);
      const { error: uerr } = await admin.from(subTable)
        .update({ expires_at: newExpire.toISOString() })
        .eq("id", existing.id);
      if (uerr) return json({ error: uerr.message }, 500);
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
      };
      if (isCheckup) insertPayload.billing_cycle = order.billing_cycle;
      const { data: sub, error: serr } = await admin.from(subTable).insert(insertPayload).select("id").single();
      if (serr) return json({ error: serr.message }, 500);
      subscriptionId = sub.id;
    }

    // 取得「匯款」provider id（若有）
    const { data: provider } = await admin
      .from("payment_providers").select("id")
      .eq("provider_type", "remittance").eq("is_active", true).maybeSingle();

    // 寫入交易紀錄（健檢時 subscription_id 留空，因為 payment_transactions 設計指向 member_subscriptions）
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
    if (txErr) {
      console.error("payment_transactions insert error:", txErr);
    }

    // 取得 expert_id（expert_plan 才有）
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
        console.error("writeRevenueSplit failed:", e);
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

    return json({ ok: true, subscriptionId, transactionId: tx?.id ?? null });
  } catch (e) {
    console.error("confirm-remittance error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
