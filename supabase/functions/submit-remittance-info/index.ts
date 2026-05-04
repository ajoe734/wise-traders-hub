import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ error: "Unauthorized" }, 401);

    const { orderId, last5, payerName } = await req.json();
    if (!orderId || !last5 || !payerName) return json({ error: "Missing fields" }, 400);
    if (!/^\d{5}$/.test(String(last5))) return json({ error: "末五碼格式錯誤" }, 400);
    const name = String(payerName).trim();
    if (!name) return json({ error: "請輸入匯款人姓名" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: order } = await admin
      .from("remittance_orders")
      .select("id, user_id, status")
      .eq("id", orderId)
      .maybeSingle();

    if (!order) return json({ error: "Order not found" }, 404);
    if (order.user_id !== u.user.id) return json({ error: "Forbidden" }, 403);
    if (order.status !== "awaiting_info") {
      return json({ error: "此訂單已送出或已處理，無法再次補填" }, 400);
    }

    const { error } = await admin.from("remittance_orders").update({
      last5: String(last5),
      payer_name: name,
      status: "pending",
    }).eq("id", orderId);

    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  } catch (e) {
    console.error("submit-remittance-info error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
