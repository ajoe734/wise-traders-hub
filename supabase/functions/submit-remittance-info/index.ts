import { jsonResponse } from "../_shared/cors.ts";
import { serviceClient, userClient } from "../_shared/supabaseClients.ts";
import { withLogging } from "../_shared/edgeLogger.ts";

const handler = withLogging("submit-remittance-info", async (req) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Unauthorized" }, { status: 401 });

  const supabase = userClient(req);
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user) return jsonResponse({ error: "Unauthorized" }, { status: 401 });

  const { orderId, last5, payerName } = await req.json();
  if (!orderId || !last5 || !payerName) return jsonResponse({ error: "Missing fields" }, { status: 400 });
  if (!/^\d{5}$/.test(String(last5))) return jsonResponse({ error: "末五碼格式錯誤" }, { status: 400 });
  const name = String(payerName).trim();
  if (!name) return jsonResponse({ error: "請輸入匯款人姓名" }, { status: 400 });

  const admin = serviceClient();
  const { data: order } = await admin
    .from("remittance_orders").select("id, user_id, status").eq("id", orderId).maybeSingle();
  if (!order) return jsonResponse({ error: "Order not found" }, { status: 404 });
  if (order.user_id !== u.user.id) return jsonResponse({ error: "Forbidden" }, { status: 403 });
  if (order.status !== "awaiting_info") {
    return jsonResponse({ error: "此訂單已送出或已處理，無法再次補填" }, { status: 400 });
  }

  const { error } = await admin.from("remittance_orders").update({
    last5: String(last5),
    payer_name: name,
    status: "pending",
  }).eq("id", orderId);

  if (error) return jsonResponse({ error: error.message }, { status: 500 });
  return jsonResponse({ ok: true });
});

Deno.serve(handler);
