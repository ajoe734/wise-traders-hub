/**
 * 金流 Webhook 簽名驗證、txId 提取與冪等性工具
 *
 * ⚠️ 此為單一來源（Single Source of Truth）。
 *    Edge Functions 從此處 import，Vitest 透過 src/lib/paymentVerify.ts re-export。
 *    禁止在各 Edge Function 中複製實作。
 *
 * 對應 Edge Functions：
 *   acpay-notify          → acpayGenerateSign, acpayParseXml, acpayExtractTxId
 *   acpay-recurring-notify → acpayDeriveKeyAndIv, acpayAesDecrypt, acpayRecurringExtractTxId
 *   ecpay-callback        → ecpayGenerateCheckMacValue, ecpayExtractTxId
 *   confirm-linepay       → linepayHmacSha256Base64
 *   line-webhook          → lineWebhookVerifySignature
 *   全部金流              → isDuplicatePaymentTx
 */

// ─── ACPay 3DS ────────────────────────────────────────────────────────────────

export async function acpayGenerateSign(
  params: Record<string, string>,
  merchantKey: string,
): Promise<string> {
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

export function acpayParseXml(xml: string): Record<string, string> {
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

/** transaction_id 優先，缺失時 fallback out_trade_no */
export function acpayExtractTxId(params: Record<string, string>): string {
  return params.transaction_id || params.out_trade_no || "";
}

// ─── ACPay 定期扣款（AES-CBC）────────────────────────────────────────────────

export function acpayDeriveKeyAndIv(
  merchantKey: string,
  nonceStr: string,
): { key: Uint8Array; iv: Uint8Array } {
  const keyStr = merchantKey.replace(/-/g, "").slice(0, 32);
  const ivStr = nonceStr.replace(/-/g, "").slice(0, 16);
  return {
    key: new TextEncoder().encode(keyStr),
    iv: new TextEncoder().encode(ivStr),
  };
}

function toPlainArrayBuffer(view: Uint8Array): ArrayBuffer {
  const sliced = view.slice();
  return sliced.buffer as ArrayBuffer;
}

export async function acpayAesDecrypt(
  encryptedBase64: string,
  key: Uint8Array,
  iv: Uint8Array,
): Promise<string> {
  const encryptedData = Uint8Array.from(atob(encryptedBase64), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    toPlainArrayBuffer(key),
    { name: "AES-CBC" },
    false,
    ["decrypt"],
  );
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv: new Uint8Array(toPlainArrayBuffer(iv)) },
    cryptoKey,
    new Uint8Array(toPlainArrayBuffer(encryptedData)),
  );
  return new TextDecoder().decode(decrypted).replace(/\0+$/, "");
}

/** transaction_id → transactionId → out_trade_no/outTradeNo 三層 fallback */
export function acpayRecurringExtractTxId(order: Record<string, string>): string {
  const outTradeNo = order.out_trade_no || order.outTradeNo || "";
  return order.transaction_id || order.transactionId || outTradeNo;
}

// ─── ECPay ────────────────────────────────────────────────────────────────────

export async function ecpayGenerateCheckMacValue(
  params: Record<string, string>,
  hashKey: string,
  hashIV: string,
): Promise<string> {
  const sorted = Object.keys(params)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((key) => `${key}=${params[key]}`)
    .join("&");

  const raw = `HashKey=${hashKey}&${sorted}&HashIV=${hashIV}`;

  let encoded = encodeURIComponent(raw).toLowerCase();
  encoded = encoded
    .replace(/%2d/g, "-")
    .replace(/%5f/g, "_")
    .replace(/%2e/g, ".")
    .replace(/%21/g, "!")
    .replace(/%2a/g, "*")
    .replace(/%28/g, "(")
    .replace(/%29/g, ")")
    .replace(/%20/g, "+")
    .replace(/%7e/g, "~");

  const encoder = new TextEncoder();
  const data = encoder.encode(encoded);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  return hashHex.toUpperCase();
}

/** TradeNo（ECPay 系統 ID）優先，缺失時 fallback MerchantTradeNo */
export function ecpayExtractTxId(params: Record<string, string>): string {
  return params.TradeNo || params.MerchantTradeNo || "";
}

// ─── LINE Pay ─────────────────────────────────────────────────────────────────

export async function linepayHmacSha256Base64(
  secret: string,
  message: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

// ─── LINE Messaging Webhook ───────────────────────────────────────────────────

/** 驗證 X-Line-Signature（HMAC-SHA256 Base64），signature 為 null 時直接回傳 false */
export async function lineWebhookVerifySignature(
  rawBody: string,
  signature: string | null,
  channelSecret: string,
): Promise<boolean> {
  if (!signature) return false;
  const computed = await linepayHmacSha256Base64(channelSecret, rawBody);
  return computed === signature;
}

// ─── 冪等性檢查（各金流共用）─────────────────────────────────────────────────

export async function isDuplicatePaymentTx(
  supabase: { from: (table: string) => any },
  providerTxId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("payment_transactions")
    .select("id")
    .eq("provider_tx_id", providerTxId)
    .eq("status", "paid");
  return data != null && data.length > 0;
}
