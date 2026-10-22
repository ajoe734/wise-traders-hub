/**
 * ecpay-refund — 綠界信用卡退刷（管理員限定）
 *
 * 用途：管理員對既有綠界信用卡交易執行全額／部分退刷，並把結果落帳：
 *   - 呼叫綠界信用卡退刷 DoAction（Action=N）
 *   - 成功後寫入負值 payment_transactions（status=refunded）、
 *     payment_intents 標記 refunded、必要時取消對應 checkup_subscription
 *   - 全程寫 audit_logs
 *
 * 冪等：同一 MerchantTradeNo 已有 REFUND- 退款紀錄時直接回報，不重複送綠界。
 * 安全：網路中斷時不自動重試（避免重複退刷），回報「結果未知」請人工到綠界後台確認。
 * 純邏輯（參數組裝／回應解析）在 _shared/ecpayRefundCore.ts，Vitest 直接測試。
 */
import { withLogging } from "../_shared/edgeLogger.ts";
import { jsonResponse, errorResponse } from "../_shared/cors.ts";
import { AuthError } from "../_shared/authGuard.ts";
import { requireCompanyAdmin } from "../_shared/adminGuard.ts";
import { serviceClient } from "../_shared/supabaseClients.ts";
import { loadEcpayCreds } from "../_shared/ecpayCredentials.ts";
import { ecpayGenerateCheckMacValue } from "../_shared/paymentVerify.ts";
import { fetchWithRetry } from "../_shared/retryFetch.ts";
import {
  validateRefundRequest,
  buildDoActionParams,
  doActionUrl,
  parseDoActionResponse,
} from "../_shared/ecpayRefundCore.ts";

const handler = withLogging("ecpay-refund", async (req, log) => {
  if (req.method !== "POST") {
    return errorResponse("只接受 POST", 405, { code: "METHOD_NOT_ALLOWED" }, req);
  }

  const callerId = await requireCompanyAdmin(req);
  const admin = serviceClient();

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const validated = validateRefundRequest({
    merchantTradeNo: body.merchantTradeNo as string,
    tradeNo: body.tradeNo as string,
    totalAmount: body.totalAmount as number,
  });
  if (!validated.ok) {
    return errorResponse(validated.message, 400, { code: "INVALID_INPUT" }, req);
  }
  const { merchantTradeNo, tradeNo, totalAmount } = validated.value;
  const checkupSubscriptionId =
    typeof body.checkupSubscriptionId === "string" && body.checkupSubscriptionId
      ? body.checkupSubscriptionId
      : null;
  const reason = typeof body.reason === "string" ? body.reason : "";

  // 冪等：已退刷過直接回報，不重複送綠界
  const refundTxKey = `REFUND-${merchantTradeNo}`;
  const { data: existing } = await admin
    .from("payment_transactions")
    .select("id")
    .eq("provider_tx_id", refundTxKey)
    .eq("status", "refunded")
    .maybeSingle();
  if (existing) {
    return jsonResponse({
      ok: true,
      alreadyRefunded: true,
      merchantTradeNo,
      refundTransactionId: existing.id,
    });
  }

  const creds = await loadEcpayCreds(admin);
  const params = buildDoActionParams(validated.value, creds.merchantId);
  params.CheckMacValue = await ecpayGenerateCheckMacValue(params, creds.hashKey, creds.hashIV);

  let doResult;
  try {
    // 金融異動：不自動重試，避免重複退刷；僅單次呼叫 + 逾時保護
    const res = await fetchWithRetry(
      doActionUrl(creds.env),
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params).toString(),
      },
      { source: "ecpay_doaction", policy: { maxAttempts: 1 } },
    );
    doResult = parseDoActionResponse(await res.text());
  } catch (e) {
    log.error("doaction_network_error", { message: (e as Error).message });
    return errorResponse(
      "與綠界連線中斷，退刷結果未知；請先到綠界商戶後台確認訂單狀態，再決定是否重試",
      502,
      { code: "UPSTREAM_UNKNOWN" },
      req,
    );
  }

  if (!doResult.ok) {
    await admin.from("audit_logs").insert({
      actor_id: callerId,
      action: "ecpay_refund.failed",
      target_type: "payment_intents",
      target_id: merchantTradeNo,
      detail: { tradeNo, totalAmount, rtnCode: doResult.rtnCode, rtnMsg: doResult.rtnMsg, reason },
    });
    return errorResponse(
      `綠界退刷失敗：${doResult.rtnMsg || doResult.rtnCode}`,
      400,
      { code: "ECPAY_REFUND_FAILED", rtnCode: doResult.rtnCode },
      req,
    );
  }

  // 退刷已在綠界完成，以下為本地落帳
  const now = new Date().toISOString();
  const { data: provider } = await admin
    .from("payment_providers")
    .select("id")
    .eq("provider_type", "ecpay")
    .maybeSingle();

  const { data: refundTx, error: txErr } = await admin
    .from("payment_transactions")
    .insert({
      subscription_id: null,
      provider_id: provider?.id ?? null,
      amount: -totalAmount,
      currency: "TWD",
      status: "refunded",
      provider_tx_id: refundTxKey,
      paid_at: now,
      discount_amount: 0,
    })
    .select("id")
    .single();
  if (txErr) {
    log.error("refund_tx_insert_failed", { message: txErr.message });
    return errorResponse(
      "退刷已在綠界完成，但本地退款紀錄寫入失敗，請人工補記",
      500,
      { code: "REFUND_LEDGER_WRITE_FAILED" },
      req,
    );
  }

  await admin.from("payment_intents").update({ status: "refunded" }).eq("trade_no", merchantTradeNo);

  let canceledSubscription = false;
  if (checkupSubscriptionId) {
    const { error: cancelErr } = await admin
      .from("checkup_subscriptions")
      .update({ status: "canceled", canceled_at: now })
      .eq("id", checkupSubscriptionId);
    canceledSubscription = !cancelErr;
    if (cancelErr) log.error("checkup_cancel_failed", { message: cancelErr.message });
  }

  await admin.from("audit_logs").insert({
    actor_id: callerId,
    action: "ecpay_refund",
    target_type: "payment_intents",
    target_id: merchantTradeNo,
    detail: {
      tradeNo,
      totalAmount,
      checkupSubscriptionId,
      canceledSubscription,
      reason,
      refundTransactionId: refundTx.id,
      rtnCode: doResult.rtnCode,
    },
  });

  return jsonResponse({
    ok: true,
    merchantTradeNo,
    refundedAmount: totalAmount,
    refundTransactionId: refundTx.id,
    canceledSubscription,
  });
});

Deno.serve(handler);
