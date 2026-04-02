import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ACpay 3DS notify_url handler (PDF section 4.6)
// Receives XML POST from ACpay after 3DS OTP verification
// Must return plain text "SUCCESS" on success

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

Deno.serve(async (req) => {
  // notify_url only receives POST from ACpay server, no CORS needed
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200 });
  }

  try {
    const body = await req.text();
    console.log("ACpay notify raw body:", body);

    const params = parseXml(body);
    console.log("ACpay notify parsed:", JSON.stringify(params));

    const merchantKey = Deno.env.get("ACPAY_MERCHANT_KEY")!;

    // Verify signature
    if (params.sign) {
      const expectedSign = await generateSign(params, merchantKey);
      if (expectedSign !== params.sign) {
        console.error("ACpay notify sign verification FAILED");
        return new Response("FAIL", { status: 200 });
      }
    }

    const payResult = params.pay_result;
    const outTradeNo = params.out_trade_no;
    const totalFee = parseInt(params.total_fee || "0", 10);
    const transactionId = params.transaction_id || outTradeNo;

    // Parse metadata from attach field
    let metadata: any = {};
    try {
      metadata = JSON.parse(params.attach || "{}");
    } catch {
      console.error("Failed to parse attach field");
    }

    const planId = metadata.plan_id;
    const billingCycle = metadata.billing_cycle;
    const userId = metadata.user_id;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Payment failed
    if (payResult !== "0") {
      console.log("ACpay payment failed, pay_result:", payResult);
      if (userId && planId) {
        try {
          await fetch(`${supabaseUrl}/functions/v1/notify-payment-failure`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify({
              userId,
              planId,
              amount: totalFee,
              provider: "acpay",
              errorDetail: `pay_result: ${payResult}`,
            }),
          });
        } catch (e) {
          console.error("Failed to send payment failure notification:", e);
        }
      }
      return new Response("SUCCESS", { status: 200 });
    }

    // Payment successful — write to DB
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Duplicate check by out_trade_no
    const { data: existingTx } = await supabase
      .from("payment_transactions")
      .select("id")
      .eq("provider_tx_id", transactionId)
      .eq("status", "paid");

    if (existingTx && existingTx.length > 0) {
      console.log("Duplicate notification for:", transactionId);
      return new Response("SUCCESS", { status: 200 });
    }

    // Get ACpay provider
    const { data: provider } = await supabase
      .from("payment_providers")
      .select("id")
      .eq("provider_type", "acpay")
      .eq("is_active", true)
      .single();

    const now = new Date();
    const expiresAt = new Date(now);
    if (billingCycle === "yearly") {
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    } else {
      expiresAt.setMonth(expiresAt.getMonth() + 1);
    }

    let subscriptionId: string | null = null;
    if (userId && planId) {
      // Duplicate subscription protection
      const { data: existing } = await supabase
        .from("member_subscriptions")
        .select("id")
        .eq("user_id", userId)
        .eq("plan_id", planId)
        .eq("status", "active");

      if (existing && existing.length > 0) {
        console.log("Active subscription already exists, skipping insert");
        subscriptionId = existing[0].id;
      } else {
        const { data: sub, error: subError } = await supabase
          .from("member_subscriptions")
          .insert({
            user_id: userId,
            plan_id: planId,
            status: "active",
            started_at: now.toISOString(),
            expires_at: expiresAt.toISOString(),
            provider_id: provider?.id || null,
          })
          .select("id")
          .single();

        if (subError) console.error("Subscription insert error:", subError);
        else subscriptionId = sub.id;
      }
    }

    // Create payment transaction
    const { error: txError } = await supabase.from("payment_transactions").insert({
      amount: totalFee,
      currency: "TWD",
      status: "paid",
      paid_at: now.toISOString(),
      provider_id: provider?.id || null,
      provider_tx_id: transactionId,
      subscription_id: subscriptionId,
    });

    if (txError) console.error("Transaction insert error:", txError);

    console.log("ACpay notify processed successfully for:", outTradeNo);
    return new Response("SUCCESS", { status: 200 });
  } catch (error) {
    console.error("acpay-notify error:", error);
    return new Response("FAIL", { status: 200 });
  }
});
