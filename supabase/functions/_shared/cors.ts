// Generic CORS helpers shared by ALL edge functions (not just checkup).
//
// Two single sources of truth in this file:
//   1. `corsHeaders` — broad allow-list covering every header the web client
//      currently sends (auth, apikey, content-type, correlation, platform/runtime).
//   2. `corsPreflight()` / `jsonResponse()` — wrappers that always emit
//      `corsHeaders`, so a function can never accidentally drop CORS on an
//      error path.

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-correlation-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  // Cache preflight 24h — supabase-js sends multiple client-platform headers
  // that trigger preflight on every cross-origin POST; without this each call
  // pays a full OPTIONS RTT.
  'Access-Control-Max-Age': '86400',
};

export function corsPreflight(): Response {
  return new Response('ok', { headers: corsHeaders });
}

export function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

export function generateErrorId(): string {
  // 短碼：時間戳(base36) + 6 位隨機，方便使用者在 toast 中回報
  const rand = Math.random().toString(36).slice(2, 8);
  return `err_${Date.now().toString(36)}_${rand}`;
}

export function errorResponse(message: string, status = 500, extra?: Record<string, unknown>): Response {
  // Default to INTERNAL_ERROR; callers wanting a specific code should pass
  // `code` in `extra` or use `codedErrorResponse` from `_shared/errorCodes.ts`.
  const code = (extra && typeof extra.code === 'string') ? extra.code : 'INTERNAL_ERROR';
  const errorId = (extra && typeof extra.errorId === 'string')
    ? extra.errorId as string
    : generateErrorId();
  // stderr 帶上 errorId，方便從 edge function logs 反查
  try { console.error(`[${errorId}] ${code} ${status}: ${message}`); } catch { /* noop */ }
  return jsonResponse(
    { code, error: code, message, errorId, ...(extra || {}) },
    {
      status,
      headers: { 'x-error-id': errorId },
    },
  );
}
