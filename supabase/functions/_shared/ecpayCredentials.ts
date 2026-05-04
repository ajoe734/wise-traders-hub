// Shared loader for ECPay credentials.
// Reads from `payment_settings` row keyed by 'ecpay_credentials' first,
// then falls back to environment variables for backward compatibility.

export type EcpayCreds = {
  merchantId: string;
  hashKey: string;
  hashIV: string;
  // Action URL for credit-card channel (the "另一個網址" provided by ECPay).
  // Falls back to apiUrl when not configured.
  creditActionUrl: string;
  // Default AIO endpoint (used by other channels if ever re-enabled).
  apiUrl: string;
  env: "stage" | "production";
  source: "db" | "env" | "mixed";
};

// Official AIO endpoints — shared across all merchants.
// ECPay does NOT issue a per-merchant URL; merchants get only MerchantID + HashKey + HashIV.
const ECPAY_PROD_AIO = "https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5";
const ECPAY_STAGE_AIO = "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5";

// deno-lint-ignore no-explicit-any
export async function loadEcpayCreds(supabase: any): Promise<EcpayCreds> {
  let dbValue: Record<string, unknown> | null = null;
  try {
    const { data } = await supabase
      .from("payment_settings")
      .select("value")
      .eq("key", "ecpay_credentials")
      .maybeSingle();
    if (data?.value && typeof data.value === "object") {
      dbValue = data.value as Record<string, unknown>;
    }
  } catch (e) {
    console.error("loadEcpayCreds: db read failed, falling back to env", e);
  }

  const envMerchantId = Deno.env.get("ECPAY_MERCHANT_ID") ?? "";
  const envHashKey = Deno.env.get("ECPAY_HASH_KEY") ?? "";
  const envHashIV = Deno.env.get("ECPAY_HASH_IV") ?? "";
  const envApiUrl = Deno.env.get("ECPAY_API_URL") ?? "";

  const merchantId = String(dbValue?.merchant_id ?? "").trim() || envMerchantId;
  const hashKey = String(dbValue?.hash_key ?? "").trim() || envHashKey;
  const hashIV = String(dbValue?.hash_iv ?? "").trim() || envHashIV;
  const env: "stage" | "production" =
    (dbValue?.env as string) === "production" ? "production" : "stage";

  // Resolve API URL:
  //   1. legacy db override (api_url)
  //   2. env var ECPAY_API_URL
  //   3. official endpoint based on `env`
  const officialAio = env === "production" ? ECPAY_PROD_AIO : ECPAY_STAGE_AIO;
  const apiUrl =
    String(dbValue?.api_url ?? "").trim() || envApiUrl || officialAio;

  // Credit-card action URL:
  //   1. legacy db override (credit_action_url)
  //   2. fall back to apiUrl (which is the env-resolved official endpoint)
  const creditActionUrl =
    String(dbValue?.credit_action_url ?? "").trim() || apiUrl;

  let source: EcpayCreds["source"] = "env";
  if (dbValue) {
    const allFromDb =
      !!dbValue.merchant_id && !!dbValue.hash_key && !!dbValue.hash_iv;
    source = allFromDb ? "db" : "mixed";
  }

  return { merchantId, hashKey, hashIV, creditActionUrl, apiUrl, env, source };
}
