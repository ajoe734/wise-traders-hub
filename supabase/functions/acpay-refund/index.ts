// AUTH: user  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { jsonResponse } from "../_shared/cors.ts";
import { serviceClient, userClient } from "../_shared/supabaseClients.ts";
import { withLogging } from "../_shared/edgeLogger.ts";

// ACpay Refund API
async function generateSign(params: Record<string, string>, merchantKey: string): Promise<string> {
  const filtered = Object.entries(params)
    .filter(([k, v]) => k !== "sign" && v !== "" && v !== undefined && v !== null)
    .sort(([a], [b]) => a.localeCompare(b));
  const str = filtered.map(([k, v]) => `${k}=${v}`).join("&") + `&key=${merchantKey}`;
  const data = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function buildXml(params: Record<string, string>): string {
  const inner = Object.entries(params).map(([k, v]) => `<${k}>${v}</${k}>`).join("");
  return `<xml>${inner}</xml>`;
}

function parseXml(xml: string): Record<string, string> {
  const result: Record<string, string> = {};
  const regex = /<(\w+)><!\[CDATA\[(.*?)\]\]><\/\1>|<(\w+)>(.*?)<\/\3>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const key = match[1] || match[3];
    const value = match[2] || match[4];
    if (key && value !== undefined) result[key] = value;
  }
  return result;
}

function generateRefundNo(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  return `RF${ts}${rand}`.slice(0, 20);
}

const handler = withLogging("acpay-refund", async (req, log) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Unauthorized" }, { status: 401 });

  const uc = userClient(req);
  const token = authHeader.replace("Bearer ", "");
  const { data: userData, error: userError } = await uc.auth.getUser(token);
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

  const merchantNo = Deno.env.get("ACPAY_MERCHANT_NO")!;
  const merchantKey = Deno.env.get("ACPAY_MERCHANT_KEY")!;
  const apiRoot2 = Deno.env.get("ACPAY_API_ROOT2") || "https://aio.payloop.com.tw";

  const adminClient = serviceClient();

  const { data: sub, error: subError } = await adminClient
    .from("member_subscriptions").select("id, user_id, plan_id").eq("id", subscription_id).single();
  if (subError || !sub || sub.user_id !== userId) {
    return jsonResponse({ error: "Subscription not found or not yours" }, { status: 403 });
  }

  const { data: originalTx } = await adminClient
    .from("payment_transactions").select("id, provider_id, provider_tx_id")
    .eq("subscription_id", subscription_id).eq("status", "paid")
    .order("created_at", { ascending: false }).limit(1).single();

  if (!originalTx?.provider_tx_id) {
    return jsonResponse({ error: "Original transaction not found" }, { status: 404 });
  }

  const outRefundNo = generateRefundNo();
  const nonceStr = crypto.randomUUID().replace(/-/g, "").slice(0, 32);

  const params: Record<string, string> = {
    service: "unified.micropay.refund",
    version: "2.0", charset: "UTF-8", sign_type: "SHA256",
    merchant_no: merchantNo,
    out_trade_no: originalTx.provider_tx_id,
    out_refund_no: outRefundNo,
    nonce_str: nonceStr,
    total_fee: String(original_amount || refund_amount),
    refund_fee: String(Math.abs(refund_amount)),
  };

  params.sign = await generateSign(params, merchantKey);
  const xmlBody = buildXml(params);

  const response = await fetch(`${apiRoot2}/Refund`, {
    method: "POST",
    headers: { "Content-Type": "application/xml" },
    body: xmlBody,
  });
  const responseText = await response.text();
  const result = parseXml(responseText);

  if (result.sign) {
    const expectedSign = await generateSign(result, merchantKey);
    if (expectedSign !== result.sign) log.error("response_sign_mismatch");
  }

  const refundSuccess = result.status === "0" && result.result_code === "0";

  const { error: txError } = await adminClient.from("payment_transactions").insert({
    subscription_id,
    amount: -Math.abs(refund_amount),
    status: refundSuccess ? "refunded" : "failed",
    paid_at: new Date().toISOString(),
    provider_id: originalTx.provider_id || null,
    provider_tx_id: `REFUND-${outRefundNo}`,
  });
  if (txError) log.error("refund_tx_insert_error", { message: txError.message });

  const { error: auditError } = await adminClient.from("audit_logs").insert({
    action: "acpay_refund",
    actor_id: userId,
    target_id: subscription_id,
    target_type: "member_subscriptions",
    detail: {
      reason: "年繳中途取消，退還剩餘月份",
      remaining_months, refund_amount, original_amount, monthly_price,
      out_refund_no: outRefundNo, acpay_result: result,
    },
  });
  if (auditError) log.error("audit_log_insert_error", { message: auditError.message });

  if (!refundSuccess) {
    return jsonResponse({
      error: result.message || result.err_msg || "Refund failed",
      acpayResult: result,
    }, { status: 400 });
  }

  return jsonResponse({ success: true, refund_amount, out_refund_no: outRefundNo });
});

Deno.serve(handler);
