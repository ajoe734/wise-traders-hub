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

export function errorResponse(message: string, status = 500, extra?: Record<string, unknown>): Response {
  return jsonResponse({ error: message, ...(extra || {}) }, { status });
}
