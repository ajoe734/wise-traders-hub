import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Auto-cancel failed renewals:
 * If a renewal subscriber's payment failed and no successful payment
 * arrived by 3:30 PM (UTC+8) the next day, cancel the subscription.
 *
 * Runs on schedule (e.g. every 30 min or hourly).
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Current time in UTC+8
    const now = new Date();
    const nowTW = new Date(now.getTime() + 8 * 60 * 60 * 1000);

    // Deadline: 3:30 PM TWD today (if now >= 15:30) or yesterday (if now < 15:30)
    // We look for failures that happened BEFORE the most recent 3:30 PM deadline
    const deadlineTW = new Date(nowTW);
    deadlineTW.setHours(15, 30, 0, 0);
    if (nowTW < deadlineTW) {
      // Before today's 3:30 PM → deadline is yesterday's 3:30 PM
      deadlineTW.setDate(deadlineTW.getDate() - 1);
    }
    // Convert deadline back to UTC
    const deadlineUTC = new Date(deadlineTW.getTime() - 8 * 60 * 60 * 1000);

    console.log("Checking failed renewals before deadline:", deadlineUTC.toISOString());

    // Find audit_logs for payment_failure_notification where isRenewal = true
    // and created_at is before the deadline
    const { data: failureLogs, error: logErr } = await supabase
      .from("audit_logs")
      .select("actor_id, target_id, created_at, detail")
      .eq("action", "payment_failure_notification")
      .lte("created_at", deadlineUTC.toISOString());

    if (logErr) throw logErr;

    if (!failureLogs || failureLogs.length === 0) {
      return new Response(
        JSON.stringify({ message: "No expired failed renewals", count: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Filter only renewal failures
    const renewalFailures = failureLogs.filter(
      (log: any) => log.detail?.isRenewal === true
    );

    if (renewalFailures.length === 0) {
      return new Response(
        JSON.stringify({ message: "No renewal failures past deadline", count: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let canceledCount = 0;

    for (const log of renewalFailures) {
      const userId = log.actor_id;
      const planId = log.target_id;
      if (!userId || !planId) continue;

      // Check if this subscription is still active (not already canceled/expired)
      const { data: activeSub } = await supabase
        .from("member_subscriptions")
        .select("id, plan_id, canceled_at")
        .eq("user_id", userId)
        .eq("plan_id", planId)
        .eq("status", "active")
        .is("canceled_at", null) // not manually canceled
        .maybeSingle();

      if (!activeSub) continue;

      // Check if a successful payment was made AFTER the failure
      const { data: successPayments } = await supabase
        .from("payment_transactions")
        .select("id")
        .eq("subscription_id", activeSub.id)
        .eq("status", "paid")
        .gte("created_at", log.created_at)
        .limit(1);

      if (successPayments && successPayments.length > 0) {
        // User paid successfully after the failure — skip
        continue;
      }

      // Cancel the subscription
      const endOfMonth = new Date(nowTW);
      endOfMonth.setMonth(endOfMonth.getMonth(), 0); // last day of current month
      endOfMonth.setHours(23, 59, 59, 999);
      const endOfMonthUTC = new Date(endOfMonth.getTime() - 8 * 60 * 60 * 1000);

      const { error: updateErr } = await supabase
        .from("member_subscriptions")
        .update({
          auto_renew: false,
          canceled_at: now.toISOString(),
          expires_at: endOfMonthUTC.toISOString(),
        })
        .eq("id", activeSub.id);

      if (updateErr) {
        console.error("Failed to cancel subscription:", activeSub.id, updateErr);
        continue;
      }

      // Audit log
      await supabase.from("audit_logs").insert({
        action: "auto_cancel_failed_renewal",
        actor_id: userId,
        target_id: activeSub.id,
        target_type: "subscription",
        detail: {
          planId,
          reason: "Payment failed and not resolved by 15:30 next day deadline",
          failedAt: log.created_at,
          deadlineAt: deadlineUTC.toISOString(),
        },
      });

      // Notify user via LINE + Email
      try {
        const notifyUrl = `${supabaseUrl}/functions/v1/notify-payment-failure`;
        await fetch(notifyUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({
            userId,
            planId,
            amount: 0,
            provider: "system",
            errorDetail: "自動取消：扣款失敗超過截止時間（隔天下午3:30），訂閱已自動取消",
          }),
        });
      } catch (e) {
        console.error("Failed to send auto-cancel notification:", e);
      }

      canceledCount++;
      console.log("Auto-canceled subscription:", activeSub.id, "user:", userId);
    }

    // Clean up processed failure logs to avoid re-processing
    if (renewalFailures.length > 0) {
      const processedIds = renewalFailures.map((l: any) => l.id).filter(Boolean);
      // We don't delete — audit_logs are kept for history.
      // The check for active subscription prevents re-processing.
    }

    return new Response(
      JSON.stringify({
        message: "Auto-cancel check complete",
        checked: renewalFailures.length,
        canceled: canceledCount,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("auto-cancel-failed-renewals error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
