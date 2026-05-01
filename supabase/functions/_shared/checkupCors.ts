// Single source of truth for CORS headers across all checkup edge functions.
// Importing this guarantees identical Access-Control-Allow-Headers everywhere,
// preventing preflight failures when the frontend adds new headers (e.g. x-correlation-id).

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
