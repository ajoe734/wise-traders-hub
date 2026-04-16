import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { processRenewalCancellations, calcAutoCancelDeadlineUTC, filterRenewalFailures } from "../_shared/subscriptionRenewal.ts";

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
    const deadlineUTC = calcAutoCancelDeadlineUTC(now);

    console.log("Checking failed renewals before deadline:", deadlineUTC.toISOString());

    // Find audit_logs for payment_failure_notification where isRenewal = true
    // Only look back 7 days to prevent scanning entire history
    const lookbackDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const { data: failureLogs, error: logErr } = await supabase
      .from("audit_logs")
      .select("actor_id, target_id, created_at, detail")
      .eq("action", "payment_failure_notification")
      .gte("created_at", lookbackDate.toISOString())
      .lte("created_at", deadlineUTC.toISOString());

    if (logErr) throw logErr;

    if (!failureLogs || failureLogs.length === 0) {
      return new Response(
        JSON.stringify({ message: "No expired failed renewals", count: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Filter only renewal failures
    const renewalFailures = filterRenewalFailures(failureLogs);

    if (renewalFailures.length === 0) {
      return new Response(
        JSON.stringify({ message: "No renewal failures past deadline", count: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { checked, canceled } = await processRenewalCancellations(supabase, renewalFailures, now);

    return new Response(
      JSON.stringify({
        message: "Auto-cancel check complete",
        checked,
        canceled,
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
