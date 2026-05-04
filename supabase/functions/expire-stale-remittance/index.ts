import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Mark stale remittance orders as expired:
// - awaiting_info > 3 days  => user never completed bank transfer / never filled info
// - pending      > 14 days  => admin never reconciled (assume the user did not actually pay)
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const now = new Date();
    const cutAwaiting = new Date(now.getTime() - 3 * 86400000).toISOString();
    const cutPending = new Date(now.getTime() - 14 * 86400000).toISOString();

    const { data: a, error: aErr } = await admin
      .from("remittance_orders")
      .update({ status: "expired" })
      .eq("status", "awaiting_info")
      .lt("created_at", cutAwaiting)
      .select("id");
    if (aErr) console.error("expire awaiting_info error:", aErr);

    const { data: p, error: pErr } = await admin
      .from("remittance_orders")
      .update({ status: "expired" })
      .eq("status", "pending")
      .lt("created_at", cutPending)
      .select("id");
    if (pErr) console.error("expire pending error:", pErr);

    return new Response(
      JSON.stringify({
        ok: true,
        expired_awaiting: a?.length ?? 0,
        expired_pending: p?.length ?? 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("expire-stale-remittance error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
