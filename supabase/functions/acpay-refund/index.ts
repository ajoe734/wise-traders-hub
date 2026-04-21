import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ACpay Refund API (PDF section 7.3)
// Endpoint: API_ROOT2/Refund
// service=unified.micropay.refund

async function generateSign(params: Record<string, string>, merchantKey: string): Promise<string> {
  const filtered = Object.entries(params)
    .filter(([k, v]) => k !== "sign" && v !== "" && v !== undefined && v !== null)
    .sort(([a], [b]) => a.localeCompare(b));
  const str = filtered.map(([k, v]) => `${k}=${v}`).join("&") + `&key=${merchantKey}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function buildXml(params: Record<string, string>): string {
  const inner = Object.entries(params)
    .map(([k, v]) => `<${k}>${v}</${k}>`)
    .join("");
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub as string;

    const {
      subscription_id,
      refund_amount,
      remaining_months,
      original_amount,
      monthly_price,
    } = await req.json();

    if (!subscription_id || refund_amount === undefined) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const merchantNo = Deno.env.get("ACPAY_MERCHANT_NO")!;
    const merchantKey = Deno.env.get("ACPAY_MERCHANT_KEY")!;
    const apiRoot2 = Deno.env.get("ACPAY_API_ROOT2") || "https://aio.payloop.com.tw";

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Verify ownership
    const { data: sub, error: subError } = await adminClient
      .from("member_subscriptions")
      .select("id, user_id, plan_id")
      .eq("id", subscription_id)
      .single();

    if (subError || !sub || sub.user_id !== userId) {
      return new Response(JSON.stringify({ error: "Subscription not found or not yours" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find original transaction
    const { data: originalTx } = await adminClient
      .from("payment_transactions")
      .select("id, provider_id, provider_tx_id")
      .eq("subscription_id", subscription_id)
      .eq("status", "paid")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!originalTx?.provider_tx_id) {
      return new Response(JSON.stringify({ error: "Original transaction not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const outRefundNo = generateRefundNo();
    const nonceStr = crypto.randomUUID().replace(/-/g, "").slice(0, 32);

    const params: Record<string, string> = {
      service: "unified.micropay.refund",
      version: "2.0",
      charset: "UTF-8",
      sign_type: "SHA256",
      merchant_no: merchantNo,
      out_trade_no: originalTx.provider_tx_id,
      out_refund_no: outRefundNo,
      nonce_str: nonceStr,
      total_fee: String(original_amount || refund_amount),
      refund_fee: String(Math.abs(refund_amount)),
    };

    params.sign = await generateSign(params, merchantKey);

    const xmlBody = buildXml(params);
    console.log("ACpay refund request:", xmlBody);

    const response = await fetch(`${apiRoot2}/Refund`, {
      method: "POST",
      headers: { "Content-Type": "application/xml" },
      body: xmlBody,
    });

    const responseText = await response.text();
    console.log("ACpay refund response:", responseText);

    const result = parseXml(responseText);

    // Verify response sign
    if (result.sign) {
      const expectedSign = await generateSign(result, merchantKey);
      if (expectedSign !== result.sign) {
        console.error("Refund response sign mismatch");
      }
    }

    const refundSuccess = result.status === "0" && result.result_code === "0";

    // Record refund transaction
    const { error: txError } = await adminClient.from("payment_transactions").insert({
      subscription_id,
      amount: -Math.abs(refund_amount),
      status: refundSuccess ? "refunded" : "failed",
      paid_at: new Date().toISOString(),
      provider_id: originalTx.provider_id || null,
      provider_tx_id: `REFUND-${outRefundNo}`,
    });

    if (txError) console.error("Refund transaction insert error:", txError);

    // Record audit log
    const { error: auditError } = await adminClient.from("audit_logs").insert({
      action: "acpay_refund",
      actor_id: userId,
      target_id: subscription_id,
      target_type: "member_subscriptions",
      detail: {
        reason: "年繳中途取消，退還剩餘月份",
        remaining_months,
        refund_amount,
        original_amount,
        monthly_price,
        out_refund_no: outRefundNo,
        acpay_result: result,
      },
    });

    if (auditError) console.error("Audit log insert error:", auditError);

    if (!refundSuccess) {
      return new Response(
        JSON.stringify({
          error: result.message || result.err_msg || "Refund failed",
          acpayResult: result,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ success: true, refund_amount, out_refund_no: outRefundNo }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("acpay-refund error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
