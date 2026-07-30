// AUTH: user  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { jsonResponse } from "../_shared/cors.ts";
import { requireCompanyAdmin, authErrorResponse } from "../_shared/adminGuard.ts";
import { serviceClient, userClient } from "../_shared/supabaseClients.ts";
import { withLogging } from "../_shared/edgeLogger.ts";

function maskId(id: string) {
  if (!id) return "";
  if (id.length <= 4) return "*".repeat(id.length);
  return "*".repeat(id.length - 4) + id.slice(-4);
}

const handler = withLogging("admin-ecpay-status", async (req) => {
  // AUTH: company_admin (unified contract — see _shared/adminGuard.ts)
  try {
    await requireCompanyAdmin(req);
  } catch (e) {
    return authErrorResponse(e, req);
  }

  const admin = serviceClient();
  const { data: row } = await admin
    .from("payment_settings").select("value")
    .eq("key", "ecpay_credentials").maybeSingle();
  const dbValue = (row?.value ?? null) as Record<string, unknown> | null;

  const envMerchantId = Deno.env.get("ECPAY_MERCHANT_ID") ?? "";
  const envApiUrl = Deno.env.get("ECPAY_API_URL") ?? "";
  const envHashKey = Deno.env.get("ECPAY_HASH_KEY") ?? "";
  const envHashIV = Deno.env.get("ECPAY_HASH_IV") ?? "";

  const merchantId = String(dbValue?.merchant_id ?? "").trim() || envMerchantId;
  const env = (dbValue?.env as string) === "production" ? "production" : "stage";
  const officialAio = env === "production"
    ? "https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5"
    : "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5";
  const apiUrl = String(dbValue?.api_url ?? "").trim() || envApiUrl || officialAio;

  const isOfficialTestStore = merchantId === "2000132";
  const isStageUrl = apiUrl.includes("payment-stage.ecpay.com.tw");

  return jsonResponse({
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
  });
});

Deno.serve(handler);
