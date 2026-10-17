// AUTH: user  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
import { corsPreflight, jsonResponse } from "../_shared/cors.ts";
import { requireCompanyAdmin, requireExpertOwnerOrAdmin, authErrorResponse } from "../_shared/adminGuard.ts";
import { withLogging } from "../_shared/edgeLogger.ts";

/**
 * Backend authorization gate for PDF export.
 * Journal/legacy calls remain company-admin-only; factsheets allow the
 * authenticated expert owner or a company admin for the requested expert.
 * This exists on top of the frontend role check so a tampered client cannot
 * bypass the restriction — the export flow refuses to start without a fresh
 * 200 from this endpoint.
 */
const handler = withLogging("authorize-pdf-export", async (req) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return jsonResponse({ message: '匯出參數格式錯誤' }, { status: 400 });
    }
    body = parsed;
  } catch {
    return jsonResponse({ message: '匯出參數格式錯誤' }, { status: 400 });
  }
  const exportType = body.export_type ?? 'journal';
  if (exportType !== 'journal' && exportType !== 'factsheet') {
    return jsonResponse({ message: '不支援的匯出類型' }, { status: 400 });
  }
  const expertId = body.expert_id;
  if (exportType === 'factsheet' && (typeof expertId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(expertId))) {
    return jsonResponse({ message: '請提供有效的專家識別碼' }, { status: 400 });
  }

  // AUTH: validated bearer subject only; ignore any supplied owner/user ID.
  let userId: string;
  try {
    if (exportType === 'factsheet' && typeof expertId === 'string') {
      ({ userId } = await requireExpertOwnerOrAdmin(req, expertId));
    } else {
      userId = await requireCompanyAdmin(req);
    }
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
