import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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

    // Verify admin role
    const { data: roleRow } = await userClient
      .from('user_roles').select('role').eq('user_id', u.user.id).eq('role', 'company_admin').maybeSingle();
    if (!roleRow) return json({ error: "Forbidden" }, 403);

    const { orderId } = await req.json();
    if (!orderId) return json({ error: "Missing orderId" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: order, error: oerr } = await admin.from("remittance_orders").select("*").eq("id", orderId).maybeSingle();
    if (oerr || !order) return json({ error: "Order not found" }, 404);
    if (order.status !== "pending") return json({ error: "Order is not pending" }, 400);

    const cycleMs = order.billing_cycle === "yearly" ? 365 * 86400000 : 30 * 86400000;
    const now = new Date();
    const expires = new Date(now.getTime() + cycleMs);

    let subscriptionId: string | null = null;

    if (order.product_kind === "checkup_plan") {
      const { data: sub, error: serr } = await admin.from("checkup_subscriptions").insert({
        user_id: order.user_id,
        plan_id: order.checkup_plan_id,
        billing_cycle: order.billing_cycle,
        status: "active",
        started_at: now.toISOString(),
        expires_at: expires.toISOString(),
        auto_renew: false,
      }).select("id").single();
      if (serr) return json({ error: serr.message }, 500);
      subscriptionId = sub.id;
    } else {
      const { data: sub, error: serr } = await admin.from("member_subscriptions").insert({
        user_id: order.user_id,
        plan_id: order.plan_id,
        status: "active",
        started_at: now.toISOString(),
        expires_at: expires.toISOString(),
        auto_renew: false,
      }).select("id").single();
      if (serr) return json({ error: serr.message }, 500);
      subscriptionId = sub.id;
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
      detail: { subscriptionId, amount: order.amount, product_kind: order.product_kind },
    });

    return json({ ok: true, subscriptionId });
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
