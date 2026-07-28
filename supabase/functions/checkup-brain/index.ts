// AUTH: user  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { codedErrorResponse } from '../_shared/errorCodes.ts';
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabaseClients.ts";
import { withLogging } from "../_shared/edgeLogger.ts";
import { validationResponse } from "../_shared/inputValidator.ts";
import { requireCheckupAuth } from "../_shared/checkupQuota.ts";

const handler = withLogging("checkup-brain", async (req, log) => {
  // P0: require auth — 否則所有用戶共用同一筆 strategy-brain / analysis-history
  const auth = await requireCheckupAuth(req, corsHeaders);
  if (!auth.ok) {
    return new Response(JSON.stringify(auth.body), {
      status: auth.status || 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userId = auth.userId!;
  const supabase = serviceClient();

  // Helper: scope every query by user_id
  const readKey = async (key: string) => {
    const { data } = await supabase
      .from("checkup_storage").select("data")
      .eq("user_id", userId).eq("key", key).maybeSingle();
    return data?.data ?? null;
  };
  const writeKey = async (key: string, data: unknown) => {
    await supabase.from("checkup_storage").upsert(
      { user_id: userId, key, data, updated_at: new Date().toISOString() },
      { onConflict: "user_id,key" },
    );
  };

  try {
    // GET — read
    if (req.method === "GET") {
      const url = new URL(req.url);
      const action = url.searchParams.get("action");

      if (action === "brain") {
        return jsonResponse({ brain: await readKey("strategy-brain") });
      }

      if (action === "history") {
        return jsonResponse({ history: (await readKey("analysis-history")) || [] });
      }

      if (action === "all") {
        const { data: rows } = await supabase
          .from("checkup_storage").select("key, data")
          .eq("user_id", userId)
          .in("key", ["strategy-brain", "analysis-history", "events"]);
        const map: Record<string, any> = {};
        (rows || []).forEach((r: any) => { map[r.key] = r.data; });
        return jsonResponse({
          brain: map["strategy-brain"] || null,
          history: map["analysis-history"] || [],
        });
      }

      return validationResponse(
        [{ key: "action", label: "action", reason: "值需為 brain / history / all" }],
        corsHeaders,
      );
    }

    // POST — write
    if (req.method === "POST") {
      let body: any = {};
      try { body = await req.json(); } catch { body = {}; }
      const { action, data } = body;

      const POST_ACTIONS = ["save-brain","save-analysis","save-events","load-events","delete-analysis","save-holdings","get-holdings","get-brain","get-analysis-history","get-research-history","save-research-history"];
      if (!action || !POST_ACTIONS.includes(action)) {
        return validationResponse(
          [{ key: "action", label: "action", reason: `值需為 ${POST_ACTIONS.join(" / ")}` }],
          corsHeaders,
        );
      }
      const NEEDS_DATA = ["save-brain","save-analysis","save-events","delete-analysis","save-holdings","save-research-history"];
      if (NEEDS_DATA.includes(action) && (data === undefined || data === null)) {
        return validationResponse(
          [{ key: "data", label: "data", reason: `action=${action} 需要 data 欄位` }],
          corsHeaders,
        );
      }

      if (action === "save-brain") {
        await writeKey("strategy-brain", data);
        return jsonResponse({ ok: true });
      }

      if (action === "save-analysis") {
        let updated: any[] = [];
        if (Array.isArray(data)) updated = data.slice(0, 30);
        else if (data == null) updated = [];
        else {
          const history = (await readKey("analysis-history")) as any[] | null;
          updated = [data, ...(Array.isArray(history) ? history : [])].slice(0, 30);
        }
        await writeKey("analysis-history", updated);
        return jsonResponse({ ok: true });
      }

      if (action === "save-events") {
        await writeKey("events", data);
        return jsonResponse({ ok: true });
      }

      if (action === "load-events") {
        return jsonResponse({ events: await readKey("events") });
      }

      if (action === "delete-analysis") {
        if (!data?.id) return jsonResponse({ error: "缺少 id" }, { status: 400 });
        const history = (await readKey("analysis-history")) as any[] | null;
        const filtered = (Array.isArray(history) ? history : []).filter((item: any) => item.id !== data.id);
        await writeKey("analysis-history", filtered);
        return jsonResponse({ ok: true });
      }

      if (action === "save-holdings") {
        await writeKey("cloud-holdings", data);
        return jsonResponse({ ok: true });
      }

      if (action === "get-holdings") {
        return jsonResponse({ content: (await readKey("cloud-holdings")) || [] });
      }

      if (action === "get-brain") {
        return jsonResponse({ content: await readKey("strategy-brain") });
      }

      if (action === "get-analysis-history") {
        return jsonResponse({ content: (await readKey("analysis-history")) || [] });
      }

      if (action === "get-research-history") {
        return jsonResponse({ content: (await readKey("research-history")) || [] });
      }

      if (action === "save-research-history") {
        await writeKey("research-history", data);
        return jsonResponse({ ok: true });
      }

      return jsonResponse({ error: "未知 action" }, { status: 400 });
    }

    return codedErrorResponse('METHOD_NOT_ALLOWED', '不支援的 HTTP 方法');
  } catch (err) {
    log.error("brain_storage_error", { message: err instanceof Error ? err.message : String(err), userId });
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonResponse({ error: message }, { status: 500 });
  }
});

Deno.serve(handler);
