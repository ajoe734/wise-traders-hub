import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const now = new Date().toISOString();

    // Find all active subscriptions that have expired (expires_at <= now)
    // This includes both: canceled subs reaching month end, and non-renewed subs
    const { data: expiredSubs, error: fetchErr } = await supabase
      .from("member_subscriptions")
      .select("id, user_id, plan_id, canceled_at")
      .eq("status", "active")
      .not("expires_at", "is", null)
      .lte("expires_at", now);

    if (fetchErr) {
      throw fetchErr;
    }

    if (!expiredSubs || expiredSubs.length === 0) {
      return new Response(
        JSON.stringify({ message: "No expired subscriptions found", count: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get expert_ids for LINE unbinding
    const planIds = [...new Set(expiredSubs.map((s) => s.plan_id))];
    const { data: plans } = await supabase
      .from("expert_plans")
      .select("id, expert_id")
      .in("id", planIds);

    const planToExpert = new Map(
      (plans || []).map((p) => [p.id, p.expert_id])
    );

    // Update status: canceled subs → 'canceled', others → 'expired'
    const canceledIds = expiredSubs.filter((s) => s.canceled_at).map((s) => s.id);
    const expiredIds = expiredSubs.filter((s) => !s.canceled_at).map((s) => s.id);

    if (canceledIds.length > 0) {
      const { error } = await supabase
        .from("member_subscriptions")
        .update({ status: "canceled" })
        .in("id", canceledIds);
      if (error) throw error;
    }

    if (expiredIds.length > 0) {
      const { error } = await supabase
        .from("member_subscriptions")
        .update({ status: "expired" })
        .in("id", expiredIds);
      if (error) throw error;
    }

    // Deactivate LINE bindings for all expired subscriptions
    for (const sub of expiredSubs) {
      const expertId = planToExpert.get(sub.plan_id);
      if (expertId) {
        await supabase
          .from("member_line_bindings")
          .update({ is_active: false })
          .eq("user_id", sub.user_id)
          .eq("expert_id", expertId);
      }
    }

    console.log(`Processed: ${canceledIds.length} canceled, ${expiredIds.length} expired`);

    return new Response(
      JSON.stringify({
        message: "Expired subscriptions processed",
        count: expiredSubs.length,
        canceled: canceledIds.length,
        expired: expiredIds.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
