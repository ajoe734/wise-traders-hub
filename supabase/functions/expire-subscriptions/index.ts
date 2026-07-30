// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';

import { corsHeaders } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/supabaseClients.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
Deno.serve(withLogging('expire-subscriptions', async (req) => {
  // AUTH: cron (Phase M-2 runtime enforcement)
  if (req.method !== 'OPTIONS') {
    try { requireCronKey(req); }
    catch (e) {
      if (e instanceof AuthError) {
        return new Response(JSON.stringify({ error: e.message, code: e.code }), {
          status: e.status,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      throw e;
    }
  }

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = serviceClient();

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

    // ===== checkup_subscriptions =====
    // 同樣的 expire 邏輯：canceled_at 存在 → canceled，否則 → expired
    let checkupCanceled = 0;
    let checkupExpired = 0;
    const { data: expiredCheckupSubs, error: checkupFetchErr } = await supabase
      .from("checkup_subscriptions")
      .select("id, user_id, canceled_at")
      .eq("status", "active")
      .not("expires_at", "is", null)
      .lte("expires_at", now);

    if (checkupFetchErr) {
      console.error("checkup fetch error:", checkupFetchErr);
    } else if (expiredCheckupSubs && expiredCheckupSubs.length > 0) {
      const cIds = expiredCheckupSubs.filter(s => s.canceled_at).map(s => s.id);
      const eIds = expiredCheckupSubs.filter(s => !s.canceled_at).map(s => s.id);
      if (cIds.length > 0) {
        const { error } = await supabase.from("checkup_subscriptions")
          .update({ status: "canceled" }).in("id", cIds);
        if (error) console.error("checkup canceled update error:", error);
        else checkupCanceled = cIds.length;
      }
      if (eIds.length > 0) {
        const { error } = await supabase.from("checkup_subscriptions")
          .update({ status: "expired" }).in("id", eIds);
        if (error) console.error("checkup expired update error:", error);
        else checkupExpired = eIds.length;
      }
      console.log(`Checkup processed: ${checkupCanceled} canceled, ${checkupExpired} expired`);
    }

    return new Response(
      JSON.stringify({
        message: "Expired subscriptions processed",
        count: expiredSubs.length,
        canceled: canceledIds.length,
        expired: expiredIds.length,
        checkup_canceled: checkupCanceled,
        checkup_expired: checkupExpired,
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
}));
