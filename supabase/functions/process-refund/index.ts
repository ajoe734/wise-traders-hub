// AUTH: user  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { jsonResponse } from "../_shared/cors.ts";
import { serviceClient, userClient } from "../_shared/supabaseClients.ts";
import { withLogging } from "../_shared/edgeLogger.ts";
import { processRefundInDB } from "../_shared/refundProcessor.ts";
import { validateInput, validationJsonResponse } from "../_shared/inputValidator.ts";

const handler = withLogging("process-refund", async (req, log) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Unauthorized" }, { status: 401 });

  const uc = userClient(req);
  const { data: userData, error: userError } = await uc.auth.getUser();
  if (userError || !userData?.user) return jsonResponse({ error: "Unauthorized" }, { status: 401 });
  const userId = userData.user.id;

  const body = await req.json();
  const { subscription_id, refund_amount, remaining_months, original_amount, monthly_price } = body;
  const issues = validateInput({
    fields: {
      subscription_id: { required: true, type: 'string', label: 'subscription_id' },
      refund_amount: { required: true, type: 'number', acceptTypes: ['string'], label: 'refund_amount' },
    },
    source: body,
  });
  if (issues.length) return validationJsonResponse(issues);
  if (Number(refund_amount) < 0) return jsonResponse({ error: "Invalid refund amount" }, { status: 400 });

  const adminClient = serviceClient();
  const { data: sub, error: subError } = await adminClient
    .from("member_subscriptions").select("id, user_id, plan_id").eq("id", subscription_id).single();
  if (subError || !sub || sub.user_id !== userId) {
    return jsonResponse({ error: "Subscription not found or not yours" }, { status: 403 });
  }

  const result = await processRefundInDB(adminClient, {
    subscriptionId: subscription_id,
    userId,
    refundAmount: refund_amount,
    remainingMonths: remaining_months,
    originalAmount: original_amount,
    monthlyPrice: monthly_price,
  });

  if (result.alreadyRefunded) return jsonResponse({ success: true, message: "已退款", refund_amount });
  if (!result.success) {
    log.error("refund_create_failed", { error: String(result.error) });
    return jsonResponse({ error: "Failed to create refund record" }, { status: 500 });
  }
  return jsonResponse({ success: true, refund_amount: result.cappedRefundAmount });
});

Deno.serve(handler);
