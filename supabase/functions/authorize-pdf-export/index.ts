// AUTH: user  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { corsPreflight, jsonResponse } from "../_shared/cors.ts";
import { requireCompanyAdmin, authErrorResponse } from "../_shared/adminGuard.ts";
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

  // AUTH: company_admin (unified contract — see _shared/adminGuard.ts)
  let userId: string;
  try {
    userId = await requireCompanyAdmin(req);
  } catch (e) {
    return authErrorResponse(e, req);
  }

  return jsonResponse({
    allowed: true,
    user_id: userId,
    issued_at: new Date().toISOString(),
  });
});

Deno.serve(handler);
