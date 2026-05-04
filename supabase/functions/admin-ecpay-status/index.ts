import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function maskId(id: string) {
  if (!id) return "";
  if (id.length <= 4) return "*".repeat(id.length);
  return "*".repeat(id.length - 4) + id.slice(-4);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: u } = await supabase.auth.getUser();
    if (!u?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: roleRow } = await supabase
      .from("user_roles").select("role")
      .eq("user_id", u.user.id).eq("role", "company_admin").maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: row } = await admin
      .from("payment_settings").select("value")
      .eq("key", "ecpay_credentials").maybeSingle();
    const dbValue = (row?.value ?? null) as Record<string, unknown> | null;

    const envMerchantId = Deno.env.get("ECPAY_MERCHANT_ID") ?? "";
    const envApiUrl = Deno.env.get("ECPAY_API_URL") ?? "";
    const envHashKey = Deno.env.get("ECPAY_HASH_KEY") ?? "";
    const envHashIV = Deno.env.get("ECPAY_HASH_IV") ?? "";

    const merchantId = String(dbValue?.merchant_id ?? "").trim() || envMerchantId;
    const apiUrl = String(dbValue?.api_url ?? "").trim() || envApiUrl ||
      "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5";
    const env = (dbValue?.env as string) === "production" ? "production" : "stage";

    const isOfficialTestStore = merchantId === "2000132";
    const isStageUrl = apiUrl.includes("payment-stage.ecpay.com.tw");

    return new Response(JSON.stringify({
      source: dbValue ? "db" : "env",
      env,
      apiUrl,
      isStageUrl,
      merchantId_masked: maskId(merchantId),
      merchantId_length: merchantId.length,
      isOfficialTestStore,
      hasHashKey: !!(String(dbValue?.hash_key ?? "").trim() || envHashKey),
      hasHashIV: !!(String(dbValue?.hash_iv ?? "").trim() || envHashIV),
      verdict: isOfficialTestStore || isStageUrl
        ? "TEST — 測試環境，金流不會真的進帳"
        : "PRODUCTION — 正式環境，金流會進到綠界後台綁定的銀行帳戶",
    }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
