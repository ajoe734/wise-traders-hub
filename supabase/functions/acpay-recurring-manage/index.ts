// AUTH: user  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { jsonResponse } from "../_shared/cors.ts";
import { serviceClient, userClient } from "../_shared/supabaseClients.ts";
import { withLogging } from "../_shared/edgeLogger.ts";

// ACREC API for recurring subscription management
function deriveKeyAndIv(merchantKey: string, nonceStr: string) {
  const keyStr = merchantKey.replace(/-/g, "").slice(0, 32);
  const ivStr = nonceStr.replace(/-/g, "").slice(0, 16);
  return { key: new TextEncoder().encode(keyStr), iv: new TextEncoder().encode(ivStr) };
}

function toPlainAB(buf: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(buf.byteLength);
  new Uint8Array(out).set(buf);
  return out;
}

async function aesEncrypt(plaintext: string, key: Uint8Array, iv: Uint8Array): Promise<string> {
  const blockSize = 32;
  const data = new TextEncoder().encode(plaintext);
  const padLen = blockSize - (data.length % blockSize);
  const padded = new Uint8Array(data.length + (padLen === blockSize ? 0 : padLen));
  padded.set(data);
  const cryptoKey = await crypto.subtle.importKey("raw", toPlainAB(key), { name: "AES-CBC" }, false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-CBC", iv: toPlainAB(iv) }, cryptoKey, toPlainAB(padded));
  const encArr = new Uint8Array(encrypted);
  const withoutExtraPadding = padLen === blockSize ? encArr : encArr.slice(0, encArr.length - 16);
  return btoa(String.fromCharCode(...withoutExtraPadding));
}

async function aesDecrypt(encryptedBase64: string, key: Uint8Array, iv: Uint8Array): Promise<string> {
  const encryptedData = Uint8Array.from(atob(encryptedBase64), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey("raw", toPlainAB(key), { name: "AES-CBC" }, false, ["decrypt"]);
  try {
    const decrypted = await crypto.subtle.decrypt({ name: "AES-CBC", iv: toPlainAB(iv) }, cryptoKey, toPlainAB(encryptedData));
    return new TextDecoder().decode(decrypted).replace(/\0+$/, "");
  } catch {
    const padded = new Uint8Array(encryptedData.length + 16);
    padded.set(encryptedData);
    for (let i = encryptedData.length; i < padded.length; i++) padded[i] = 16;
    const decrypted = await crypto.subtle.decrypt({ name: "AES-CBC", iv: toPlainAB(iv) }, cryptoKey, toPlainAB(padded));
    return new TextDecoder().decode(decrypted).replace(/[\0\x01-\x1f]+$/, "");
  }
}

const handler = withLogging("acpay-recurring-manage", async (req) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Unauthorized" }, { status: 401 });

  const uc = userClient(req);
  const token = authHeader.replace("Bearer ", "");
  const { data: userData, error: userError } = await uc.auth.getUser(token);
  if (userError || !userData?.user) return jsonResponse({ error: "Unauthorized" }, { status: 401 });
  const userId = userData.user.id;

  const { action, subscriptionId, outTradeNo } = await req.json();
  if (!action || !subscriptionId) return jsonResponse({ error: "Missing action or subscriptionId" }, { status: 400 });

  const merchantNo = Deno.env.get("ACPAY_MERCHANT_NO")!;
  const merchantKey = Deno.env.get("ACPAY_MERCHANT_KEY")!;
  const recApiUrl = Deno.env.get("ACPAY_REC_URL") || "https://rec.payloop.com.tw";

  const adminClient = serviceClient();

  const { data: sub, error: subError } = await adminClient
    .from("member_subscriptions").select("id, user_id, plan_id").eq("id", subscriptionId).single();
  if (subError || !sub || sub.user_id !== userId) {
    return jsonResponse({ error: "Subscription not found or not yours" }, { status: 403 });
  }

  let tradeNo = outTradeNo;
  if (!tradeNo) {
    const { data: tx } = await adminClient
      .from("payment_transactions").select("provider_tx_id")
      .eq("subscription_id", subscriptionId).eq("status", "paid")
      .order("created_at", { ascending: true }).limit(1).single();
    tradeNo = tx?.provider_tx_id || "";
  }

  const nonceStr = crypto.randomUUID().replace(/-/g, "").slice(0, 32);
  const { key, iv } = deriveKeyAndIv(merchantKey, nonceStr);

  if (action === "find") {
    const requestData = { service: "recurring.find", merchant_no: merchantNo, out_trade_no: tradeNo };
    const encrypted = await aesEncrypt(JSON.stringify(requestData), key, iv);
    const response = await fetch(recApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ merchant_no: merchantNo, nonce_str: nonceStr, data: encrypted }),
    });
    const resBody = await response.json();
    const decrypted = await aesDecrypt(resBody.data, key, iv);
    const result = JSON.parse(decrypted);
    return jsonResponse({ success: true, recurring: result });
  }

  if (action === "cancel") {
    const now = new Date();
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const activeDate = `${endOfMonth.getFullYear()}-${String(endOfMonth.getMonth() + 1).padStart(2, "0")}-${String(endOfMonth.getDate()).padStart(2, "0")}`;
    const requestData = {
      service: "recurring.cancel", merchant_no: merchantNo,
      out_trade_no: tradeNo, active_date: activeDate,
    };
    const encrypted = await aesEncrypt(JSON.stringify(requestData), key, iv);
    const response = await fetch(recApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ merchant_no: merchantNo, nonce_str: nonceStr, data: encrypted }),
    });
    const resBody = await response.json();
    const decrypted = await aesDecrypt(resBody.data, key, iv);
    const result = JSON.parse(decrypted);

    if (result.err_code === "0" || result.status === "0") {
      await adminClient.from("member_subscriptions")
        .update({ auto_renew: false, canceled_at: now.toISOString() })
        .eq("id", subscriptionId);
    }
    return jsonResponse({ success: true, result });
  }

  return jsonResponse({ error: "Unknown action" }, { status: 400 });
});

Deno.serve(handler);
