import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function hmacSha256Base64(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { planId, billingCycle, slug, amount, planName, expertName, origin } = await req.json();

    if (!planId || !billingCycle || !slug || !amount || !origin) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const channelId = Deno.env.get("LINEPAY_CHANNEL_ID")!;
    const channelSecret = Deno.env.get("LINEPAY_CHANNEL_SECRET")!;
    // Control simulate mode via env var — set to "false" in production
    const isSimulate = (Deno.env.get("LINEPAY_SIMULATE") || "true") === "true";

    const orderId = `ORDER-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const nonce = crypto.randomUUID();

    const requestBody = {
      amount,
      currency: "TWD",
      orderId,
      packages: [
        {
          id: planId,
          amount,
          name: expertName || "訂閱方案",
          products: [
            {
              name: planName || "訂閱方案",
              quantity: 1,
              price: amount,
            },
          ],
        },
      ],
      redirectUrls: {
        confirmUrl: `${origin}/app/checkout/${slug}/${planId}?linepay=confirm&billingCycle=${billingCycle}&simulate=${isSimulate}`,
        cancelUrl: `${origin}/app/checkout/${slug}/${planId}?linepay=cancel`,
      },
    };

    const linepayApiUrl = Deno.env.get("LINEPAY_API_URL") || "https://sandbox-api-pay.line.me";
    const apiUri = "/v3/payments/request";
    const bodyStr = JSON.stringify(requestBody);
    const signatureMessage = channelSecret + apiUri + bodyStr + nonce;
    const signature = await hmacSha256Base64(channelSecret, signatureMessage);

    const response = await fetch(`${linepayApiUrl}${apiUri}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-LINE-ChannelId": channelId,
        "X-LINE-Authorization-Nonce": nonce,
        "X-LINE-Authorization": signature,
      },
      body: bodyStr,
    });

    const result = await response.json();

    if (result.returnCode !== "0000") {
      console.error("LINE Pay Request API error:", result);
      return new Response(JSON.stringify({ error: result.returnMessage || "LINE Pay error" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        paymentUrl: result.info.paymentUrl.web,
        transactionId: result.info.transactionId,
        orderId,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("create-linepay-order error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
