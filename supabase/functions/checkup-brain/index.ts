// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { codedErrorResponse } from '../_shared/errorCodes.ts';
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabaseClients.ts";
import { withLogging } from "../_shared/edgeLogger.ts";
import { validationResponse } from "../_shared/inputValidator.ts";

const handler = withLogging("checkup-brain", async (req, log) => {
  const supabase = serviceClient();

  try {
    // GET — read
    if (req.method === "GET") {
      const url = new URL(req.url);
      const action = url.searchParams.get("action");

      if (action === "brain") {
        const { data } = await supabase
          .from("checkup_storage").select("data")
          .eq("key", "strategy-brain").maybeSingle();
        return jsonResponse({ brain: data?.data || null });
      }

      if (action === "history") {
        const { data } = await supabase
          .from("checkup_storage").select("data")
          .eq("key", "analysis-history").maybeSingle();
        return jsonResponse({ history: data?.data || [] });
      }

      if (action === "all") {
        const { data: rows } = await supabase
          .from("checkup_storage").select("key, data")
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
        await supabase.from("checkup_storage")
          .upsert({ key: "strategy-brain", data, updated_at: new Date().toISOString() }, { onConflict: "key" });
        return jsonResponse({ ok: true });
      }

      if (action === "save-analysis") {
        let updated: any[] = [];
        if (Array.isArray(data)) updated = data.slice(0, 30);
        else if (data == null) updated = [];
        else {
          const { data: existing } = await supabase
            .from("checkup_storage").select("data").eq("key", "analysis-history").maybeSingle();
          const history = Array.isArray(existing?.data) ? existing.data : [];
          updated = [data, ...history].slice(0, 30);
        }
        await supabase.from("checkup_storage")
          .upsert({ key: "analysis-history", data: updated, updated_at: new Date().toISOString() }, { onConflict: "key" });
        return jsonResponse({ ok: true });
      }

      if (action === "save-events") {
        await supabase.from("checkup_storage")
          .upsert({ key: "events", data, updated_at: new Date().toISOString() }, { onConflict: "key" });
        return jsonResponse({ ok: true });
      }

      if (action === "load-events") {
        const { data: row } = await supabase
          .from("checkup_storage").select("data").eq("key", "events").maybeSingle();
        return jsonResponse({ events: row?.data || null });
      }

      if (action === "delete-analysis") {
        if (!data?.id) return jsonResponse({ error: "缺少 id" }, { status: 400 });
        const { data: existing } = await supabase
          .from("checkup_storage").select("data").eq("key", "analysis-history").maybeSingle();
        const history = Array.isArray(existing?.data) ? existing.data : [];
        const filtered = history.filter((item: any) => item.id !== data.id);
        await supabase.from("checkup_storage").upsert(
          { key: "analysis-history", data: filtered, updated_at: new Date().toISOString() },
          { onConflict: "key" },
        );
        return jsonResponse({ ok: true });
      }

      if (action === "save-holdings") {
        await supabase.from("checkup_storage").upsert(
          { key: "cloud-holdings", data, updated_at: new Date().toISOString() },
          { onConflict: "key" },
        );
        return jsonResponse({ ok: true });
      }

      if (action === "get-holdings") {
        const { data: row } = await supabase
          .from("checkup_storage").select("data").eq("key", "cloud-holdings").maybeSingle();
        return jsonResponse({ content: row?.data || [] });
      }

      if (action === "get-brain") {
        const { data: row } = await supabase
          .from("checkup_storage").select("data").eq("key", "strategy-brain").maybeSingle();
        return jsonResponse({ content: row?.data || null });
      }

      if (action === "get-analysis-history") {
        const { data: row } = await supabase
          .from("checkup_storage").select("data").eq("key", "analysis-history").maybeSingle();
        return jsonResponse({ content: row?.data || [] });
      }

      if (action === "get-research-history") {
        const { data: row } = await supabase
          .from("checkup_storage").select("data").eq("key", "research-history").maybeSingle();
        return jsonResponse({ content: row?.data || [] });
      }

      if (action === "save-research-history") {
        await supabase.from("checkup_storage").upsert(
          { key: "research-history", data, updated_at: new Date().toISOString() },
          { onConflict: "key" },
        );
        return jsonResponse({ ok: true });
      }

      return jsonResponse({ error: "未知 action" }, { status: 400 });
    }

    return codedErrorResponse('METHOD_NOT_ALLOWED', '不支援的 HTTP 方法');
  } catch (err) {
    log.error("brain_storage_error", { message: err instanceof Error ? err.message : String(err) });
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonResponse({ error: message }, { status: 500 });
  }
});

Deno.serve(handler);
