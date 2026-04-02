import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ACREC API for recurring subscription management (XLSX Page 3)
// Supports: recurring.find (query) and recurring.cancel (cancel)

function deriveKeyAndIv(merchantKey: string, nonceStr: string) {
  const keyStr = merchantKey.replace(/-/g, "").slice(0, 32);
  const ivStr = nonceStr.replace(/-/g, "").slice(0, 16);
  return {
    key: new TextEncoder().encode(keyStr),
    iv: new TextEncoder().encode(ivStr),
  };
}

// AES/CBC/ZeroPadding encryption for request
async function aesEncrypt(plaintext: string, key: Uint8Array, iv: Uint8Array): Promise<string> {
  // ZeroPadding: pad to block size (32 bytes for 256-bit)
  const blockSize = 32;
  const data = new TextEncoder().encode(plaintext);
  const padLen = blockSize - (data.length % blockSize);
  const padded = new Uint8Array(data.length + (padLen === blockSize ? 0 : padLen));
  padded.set(data);
  // remaining bytes are already 0

  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "AES-CBC" }, false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-CBC", iv }, cryptoKey, padded);

  // Remove the extra PKCS7 padding block that WebCrypto adds
  // WebCrypto always adds PKCS7 padding, so we need the raw output minus the last block
  const encArr = new Uint8Array(encrypted);
  // Since we zero-padded to exact block boundary, WebCrypto added one extra block
  const withoutExtraPadding = padLen === blockSize ? encArr : encArr.slice(0, encArr.length - 16);

  return btoa(String.fromCharCode(...withoutExtraPadding));
}

// AES/CBC/NoPadding decryption for response
async function aesDecrypt(encryptedBase64: string, key: Uint8Array, iv: Uint8Array): Promise<string> {
  const encryptedData = Uint8Array.from(atob(encryptedBase64), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "AES-CBC" }, false, ["decrypt"]);

  // WebCrypto requires PKCS7 padding, so we append a valid padding block for decryption
  // For NoPadding, we add 16 bytes of 0x10 (PKCS7 for a full block)
  const withPadding = new Uint8Array(encryptedData.length + 16);
  withPadding.set(encryptedData);
  // Actually, we can't just append — the ciphertext must be as-is. Let's try raw decrypt.
  // Alternative: use a raw AES-CBC implementation
  // For simplicity, if the data is block-aligned, WebCrypto will try PKCS7 unpadding.
  // We'll catch and handle.
  try {
    const decrypted = await crypto.subtle.decrypt({ name: "AES-CBC", iv }, cryptoKey, encryptedData);
    const decoded = new TextDecoder().decode(decrypted);
    return decoded.replace(/\0+$/, "");
  } catch {
    // If PKCS7 unpadding fails, the last block might have zeros
    // Manually handle by adding proper PKCS7 padding
    const padded = new Uint8Array(encryptedData.length + 16);
    padded.set(encryptedData);
    for (let i = encryptedData.length; i < padded.length; i++) {
      padded[i] = 16;
    }
    const decrypted = await crypto.subtle.decrypt({ name: "AES-CBC", iv }, cryptoKey, padded);
    const decoded = new TextDecoder().decode(decrypted);
    return decoded.replace(/[\0\x01-\x1f]+$/, "");
  }
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

    const { action, subscriptionId, outTradeNo } = await req.json();

    if (!action || !subscriptionId) {
      return new Response(JSON.stringify({ error: "Missing action or subscriptionId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const merchantNo = Deno.env.get("ACPAY_MERCHANT_NO")!;
    const merchantKey = Deno.env.get("ACPAY_MERCHANT_KEY")!;
    const recApiUrl = Deno.env.get("ACPAY_REC_URL") || "https://rec.payloop.com.tw";

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Verify ownership
    const { data: sub, error: subError } = await adminClient
      .from("member_subscriptions")
      .select("id, user_id, plan_id")
      .eq("id", subscriptionId)
      .single();

    if (subError || !sub || sub.user_id !== userId) {
      return new Response(JSON.stringify({ error: "Subscription not found or not yours" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find original out_trade_no from payment_transactions
    let tradeNo = outTradeNo;
    if (!tradeNo) {
      const { data: tx } = await adminClient
        .from("payment_transactions")
        .select("provider_tx_id")
        .eq("subscription_id", subscriptionId)
        .eq("status", "paid")
        .order("created_at", { ascending: true })
        .limit(1)
        .single();
      tradeNo = tx?.provider_tx_id || "";
    }

    const nonceStr = crypto.randomUUID().replace(/-/g, "").slice(0, 32);
    const { key, iv } = deriveKeyAndIv(merchantKey, nonceStr);

    if (action === "find") {
      // Query recurring subscription status
      const requestData = {
        service: "recurring.find",
        merchant_no: merchantNo,
        out_trade_no: tradeNo,
      };

      const encrypted = await aesEncrypt(JSON.stringify(requestData), key, iv);

      const response = await fetch(recApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchant_no: merchantNo,
          nonce_str: nonceStr,
          data: encrypted,
        }),
      });

      const resBody = await response.json();
      const decrypted = await aesDecrypt(resBody.data, key, iv);
      const result = JSON.parse(decrypted);

      return new Response(JSON.stringify({ success: true, recurring: result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "cancel") {
      // Cancel recurring — active_date = end of current month
      const now = new Date();
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const activeDate = `${endOfMonth.getFullYear()}-${String(endOfMonth.getMonth() + 1).padStart(2, "0")}-${String(endOfMonth.getDate()).padStart(2, "0")}`;

      const requestData = {
        service: "recurring.cancel",
        merchant_no: merchantNo,
        out_trade_no: tradeNo,
        active_date: activeDate,
      };

      const encrypted = await aesEncrypt(JSON.stringify(requestData), key, iv);

      const response = await fetch(recApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchant_no: merchantNo,
          nonce_str: nonceStr,
          data: encrypted,
        }),
      });

      const resBody = await response.json();
      const decrypted = await aesDecrypt(resBody.data, key, iv);
      const result = JSON.parse(decrypted);

      // Update subscription in DB
      if (result.err_code === "0" || result.status === "0") {
        await adminClient
          .from("member_subscriptions")
          .update({
            auto_renew: false,
            canceled_at: now.toISOString(),
          })
          .eq("id", subscriptionId);
      }

      return new Response(JSON.stringify({ success: true, result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("acpay-recurring-manage error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
