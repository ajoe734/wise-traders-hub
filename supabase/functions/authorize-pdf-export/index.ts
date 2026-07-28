// AUTH: user  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { corsPreflight, jsonResponse } from "../_shared/cors.ts";
import { userClient } from "../_shared/supabaseClients.ts";
import { withLogging } from "../_shared/edgeLogger.ts";

/**
 * Backend authorization gate for journal PDF export.
 * Frontend calls this before rendering the PDF; only `company_admin` may proceed.
 * This exists on top of the frontend role check so a tampered client cannot
 * bypass the restriction — the export flow refuses to start without a fresh
 * 200 from this endpoint.
 */
const handler = withLogging("authorize-pdf-export", async (req) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Unauthorized", reason: "missing_auth" }, { status: 401 });
  }

  const supabase = userClient(req);
  const { data: u, error: uErr } = await supabase.auth.getUser();
  if (uErr || !u?.user) {
    return jsonResponse({ error: "Unauthorized", reason: "invalid_token" }, { status: 401 });
  }

  const { data: roleRow, error: rErr } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", u.user.id)
    .eq("role", "company_admin")
    .maybeSingle();

  if (rErr) {
    return jsonResponse({ error: "RoleLookupFailed", message: rErr.message }, { status: 500 });
  }
  if (!roleRow) {
    return jsonResponse(
      { error: "Forbidden", reason: "not_company_admin", message: "僅後台管理員可匯出 PDF" },
      { status: 403 },
    );
  }

  return jsonResponse({
    allowed: true,
    user_id: u.user.id,
    issued_at: new Date().toISOString(),
  });
});

Deno.serve(handler);
