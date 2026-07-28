// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { jsonResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabaseClients.ts";
import { withLogging } from "../_shared/edgeLogger.ts";

// Mark stale remittance orders as expired:
// - awaiting_info > 3 days  => user never completed bank transfer / never filled info
// - pending      > 14 days  => admin never reconciled (assume the user did not actually pay)
const handler = withLogging("expire-stale-remittance", async (_req, log) => {
  const admin = serviceClient();
  const now = new Date();
  const cutAwaiting = new Date(now.getTime() - 3 * 86400000).toISOString();
  const cutPending = new Date(now.getTime() - 14 * 86400000).toISOString();

  const { data: a, error: aErr } = await admin
    .from("remittance_orders").update({ status: "expired" })
    .eq("status", "awaiting_info").lt("created_at", cutAwaiting).select("id");
  if (aErr) log.error("expire_awaiting_info_error", { message: aErr.message });

  const { data: p, error: pErr } = await admin
    .from("remittance_orders").update({ status: "expired" })
    .eq("status", "pending").lt("created_at", cutPending).select("id");
  if (pErr) log.error("expire_pending_error", { message: pErr.message });

  return jsonResponse({
    ok: true,
    expired_awaiting: a?.length ?? 0,
    expired_pending: p?.length ?? 0,
  });
});

Deno.serve(handler);
