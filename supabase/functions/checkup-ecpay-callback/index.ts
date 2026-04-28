import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { ecpayGenerateCheckMacValue, ecpayExtractTxId, isDuplicatePaymentTx } from "../_shared/paymentVerify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const formData = await req.formData();
    const params: Record<string, string> = {};
    for (const [key, value] of formData.entries()) params[key] = String(value);

    console.log("Checkup ECPay callback:", JSON.stringify(params));

    const receivedMac = params.CheckMacValue;
    const { CheckMacValue, ...paramsWithoutMac } = params;
    const hashKey = Deno.env.get("ECPAY_HASH_KEY")!;
    const hashIV = Deno.env.get("ECPAY_HASH_IV")!;
    const expected = await ecpayGenerateCheckMacValue(paramsWithoutMac, hashKey, hashIV);

    if (receivedMac !== expected) {
      console.error("Checkup CheckMacValue mismatch");
      return new Response("0|CheckMacValue Error", { status: 200 });
    }

    const rtnCode = params.RtnCode;
    const tradeAmt = parseInt(params.TradeAmt || "0");
    const customField1 = params.CustomField1 || "";  // "CK:<uuid>"
    const billingCycle = params.CustomField2;
    const userId = params.CustomField4;

    if (!customField1.startsWith("CK:")) {
      console.error("Not a checkup order, ignoring");
      return new Response("1|OK", { status: 200 });
    }
    const checkupPlanId = customField1.slice(3);

    if (rtnCode !== "1") {
      console.log("Checkup payment failed, RtnCode:", rtnCode);
      return new Response("1|OK", { status: 200 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const txId = ecpayExtractTxId(params);
    if (await isDuplicatePaymentTx(supabase, txId)) {
      console.log("Duplicate checkup notification:", txId);
      return new Response("1|OK", { status: 200 });
    }

    const { data: provider } = await supabase
      .from("payment_providers").select("id")
      .eq("provider_type", "ecpay").eq("is_active", true).maybeSingle();

    const now = new Date();
    const expiresAt = new Date(now);
    if (billingCycle === "yearly") expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    else expiresAt.setMonth(expiresAt.getMonth() + 1);

    // 防重：已 active 不重建
    const { data: existing } = await supabase
      .from("checkup_subscriptions")
      .select("id")
      .eq("user_id", userId)
      .eq("plan_id", checkupPlanId)
      .eq("status", "active")
      .maybeSingle();

    let subscriptionId: string | null = existing?.id ?? null;
    if (!existing) {
      const { data: sub, error } = await supabase
        .from("checkup_subscriptions")
        .insert({
          user_id: userId,
          plan_id: checkupPlanId,
          billing_cycle: billingCycle,
          status: "active",
          started_at: now.toISOString(),
          expires_at: expiresAt.toISOString(),
          provider_id: provider?.id ?? null,
        })
        .select("id").single();
      if (error) {
        console.error("checkup_subscriptions insert error:", error);
        return new Response("0|Error", { status: 200 });
      }
      subscriptionId = sub.id;
    }

    // 交易紀錄（subscription_id 留空，因為 payment_transactions 預設指向 member_subscriptions；
    // 健檢交易僅記金額與 provider_tx_id 作為對帳依據）
    await supabase.from("payment_transactions").insert({
      amount: tradeAmt,
      currency: "TWD",
      status: "paid",
      paid_at: now.toISOString(),
      provider_id: provider?.id ?? null,
      provider_tx_id: txId,
      subscription_id: null,
    });

    return new Response("1|OK", { status: 200 });
  } catch (error) {
    console.error("checkup-ecpay-callback error:", error);
    return new Response("0|Error", { status: 200 });
  }
});
