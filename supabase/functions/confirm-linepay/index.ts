// AUTH: webhook-signature  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// 本 function 不信任 client body：只收 { orderId, transactionId }，
// user/plan/amount 一律由 payment_intents 反查，並強制向 LINE Pay confirm 驗證。
// 邏輯全在 ../_shared/linepayConfirm.ts（可測試單一資料源）。
import { jsonResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabaseClients.ts";
import { withLogging } from "../_shared/edgeLogger.ts";
import { confirmLinepayPayment } from "../_shared/linepayConfirm.ts";

const handler = withLogging("confirm-linepay", async (req, log) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ success: false, code: "BAD_REQUEST", error: "invalid JSON body" }, { status: 400 });
  }

  const outcome = await confirmLinepayPayment({
    supabase: serviceClient(),
    fetchFn: fetch,
    env: (k: string) => Deno.env.get(k) ?? undefined,
    log: { error: (evt, data) => log.error(evt, data as Record<string, unknown>) },
  }, body);

  return jsonResponse(outcome.body, { status: outcome.status });
});

Deno.serve(handler);
