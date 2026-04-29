import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// SHA-256 signing per ACpay spec (section 10)
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

// Build XML from key-value pairs
function buildXml(tag: string, params: Record<string, string>): string {
  const inner = Object.entries(params)
    .map(([k, v]) => `<${k}>${v}</${k}>`)
    .join("");
  return `<xml>${inner}</xml>`;
}

// Parse XML response to key-value map (simple regex parser for flat XML)
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

// Generate out_trade_no: max 20 chars, alphanumeric, unique
function generateOutTradeNo(): string {
  const ts = Date.now().toString(36).toUpperCase(); // ~8 chars
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `AC${ts}${rand}`.slice(0, 20);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      prime,
      amount,
      phone,
      countryCode,
      cardHolderName,
      cardHolderEmail,
      planId,
      billingCycle,
      userId,
      origin,
      slug,
      planName,
      expertName,
      // Stage 3 additions
      originalAmount,
      discountAmount,
      discountReason,
      attribution,
      expertId,
      upgradeFromSubscriptionId,
    } = await req.json();

    if (!prime || !amount || !planId) {
      return new Response(JSON.stringify({ error: "Missing required fields: prime, amount, planId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const merchantNo = Deno.env.get("ACPAY_MERCHANT_NO")!;
    const merchantKey = Deno.env.get("ACPAY_MERCHANT_KEY")!;
    const apiRoot = Deno.env.get("ACPAY_API_ROOT") || "https://aiodir.payloop.com.tw";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const outTradeNo = generateOutTradeNo();
    const nonceStr = crypto.randomUUID().replace(/-/g, "").slice(0, 32);

    // callback_url: 3DS OTP complete → redirect user back
    const callbackUrl = `${origin}/app/checkout/${slug}/${planId}?acpay=result&billingCycle=${billingCycle}`;
    // notify_url: ACpay async server-to-server notification
    const notifyUrl = `${supabaseUrl}/functions/v1/acpay-notify`;

    const itemName = `${expertName || "方案"} - ${planName || "訂閱"} (${billingCycle === "yearly" ? "年繳" : "月繳"})`;

    // Build request params per PDF 4.1.1 + 4.1.3 (Prime mode)
    const params: Record<string, string> = {
      service: "vmj",
      version: "2.0",
      charset: "UTF-8",
      sign_type: "SHA256",
      merchant_no: merchantNo,
      out_trade_no: outTradeNo,
      nonce_str: nonceStr,
      body: itemName,
      total_fee: String(amount),
      mch_create_ip: "127.0.0.1",
      notify_url: notifyUrl,
      callback_url: callbackUrl,
      // Prime mode specific
      prime: prime,
      card_holder_phone_number: (phone || "").replace(/^0/, ""),
      country_code: countryCode || "886",
      card_holder_name: cardHolderName || "",
      card_holder_email: cardHolderEmail || "",
      // 3DS
      three_domain_secure: "Y",
      trade_mode: "0", // Normal (non-installment)
      // Recurring (ACPG定期定額)
      remember: "Y",
      period_type: "m",
      period_frequency: "1",
      // Attach metadata via attach field (will be returned in notify)
      attach: JSON.stringify({
        plan_id: planId,
        billing_cycle: billingCycle,
        user_id: userId || "",
        slug: slug || "",
      }),
    };

    // If yearly, set recurring_total_fee to the same amount
    if (billingCycle === "yearly") {
      params.period_type = "y";
      params.period_frequency = "1";
    }

    // Generate SHA-256 signature
    params.sign = await generateSign(params, merchantKey);

    // POST XML to ACpay AIO API_ROOT
    const xmlBody = buildXml("xml", params);
    console.log("ACpay request XML:", xmlBody);

    const aioResponse = await fetch(apiRoot, {
      method: "POST",
      headers: { "Content-Type": "application/xml" },
      body: xmlBody,
    });

    const responseText = await aioResponse.text();
    console.log("ACpay response:", responseText);

    const result = parseXml(responseText);
    const status = result.status;
    const resultCode = result.result_code;

    // Verify response sign
    if (result.sign) {
      const expectedSign = await generateSign(result, merchantKey);
      if (expectedSign !== result.sign) {
        console.error("ACpay response sign verification failed");
        return new Response(JSON.stringify({ error: "Sign verification failed" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (status !== "0") {
      // Payment initiation failed
      const errMsg = result.message || result.err_msg || "Payment failed";
      console.error("ACpay error:", errMsg);

      // Notify payment failure
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
              amount,
              provider: "acpay",
              errorDetail: `status: ${status}, msg: ${errMsg}`,
            }),
          });
        } catch (e) {
          console.error("Failed to send payment failure notification:", e);
        }
      }

      return new Response(JSON.stringify({ error: errMsg, status }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3DS flow: return code_url for OTP redirect
    if (result.code_url) {
      return new Response(
        JSON.stringify({
          threeDS: true,
          codeUrl: result.code_url,
          outTradeNo,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // non-3DS flow: synchronous result (pay_result=0 means success)
    const payResult = result.pay_result;
    if (payResult === "0") {
      // Payment successful — write to DB
      const supabase = createClient(supabaseUrl, serviceRoleKey);

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
        // Duplicate protection
        const { data: existing } = await supabase
          .from("member_subscriptions")
          .select("id")
          .eq("user_id", userId)
          .eq("plan_id", planId)
          .eq("status", "active");

        if (existing && existing.length > 0) {
          return new Response(
            JSON.stringify({ success: true, subscriptionId: existing[0].id, duplicate: true }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

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

      // Create payment transaction
      await supabase.from("payment_transactions").insert({
        amount,
        currency: "TWD",
        status: "paid",
        paid_at: now.toISOString(),
        provider_id: provider?.id || null,
        provider_tx_id: result.transaction_id || outTradeNo,
        subscription_id: subscriptionId,
      });

      return new Response(
        JSON.stringify({ success: true, subscriptionId }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // pay_result != 0 → failed
    return new Response(
      JSON.stringify({ error: "Payment failed", payResult }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("create-acpay-order error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
