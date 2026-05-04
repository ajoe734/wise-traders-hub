// DEPRECATED: 平台改採「手動續訂」模型，所有金流（ECPay/LINE Pay/匯款）皆為單筆扣款，
// 不會再有「自動扣款失敗」的場景。本函式保留為 410 stub，避免歷史排程／前端呼叫造成 500。
// 過期斷權邏輯統一由 expire-subscriptions 處理。

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  return new Response(
    JSON.stringify({
      deprecated: true,
      message:
        "auto-cancel-failed-renewals 已停用：平台改採手動續訂模型，無自動扣款流程",
    }),
    {
      status: 410,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
