// Generic CORS helpers shared by ALL edge functions.
//
// Two modes:
//   1. Default (no req arg)  → wildcard `Access-Control-Allow-Origin: *`.
//      Behaviour identical to the historical helper; 100+ existing functions
//      keep working unchanged.
//   2. `{ credentials: true }` + req → echo the request's Origin against a
//      whitelist and set `Access-Control-Allow-Credentials: true`. Required
//      for endpoints called via navigator.sendBeacon or fetch with
//      `credentials: 'include'` (e.g. traffic-ingest), because the browser
//      drops the response when Allow-Origin is `*` and credentials are sent.
//
// See docs/architecture/holdings-modules.md for background.

const ALLOWED_ORIGIN_EXACT = new Set<string>([
  'https://legendflow.tw',
  'https://www.legendflow.tw',
  'http://localhost:8080',
  'http://localhost:5173',
  'http://127.0.0.1:8080',
]);

const ALLOWED_ORIGIN_SUFFIX = [
  '.lovable.app',
  '.lovableproject.com',
  '.lovable.dev',
];

export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGIN_EXACT.has(origin)) return true;
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return ALLOWED_ORIGIN_SUFFIX.some((s) => host === s.slice(1) || host.endsWith(s));
  } catch {
    return false;
  }
}

const BASE_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-correlation-id, x-request-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-request-id, x-error-id',
  'Access-Control-Max-Age': '86400',
};

// Back-compat: existing callers that spread `...corsHeaders` keep the
// wildcard behaviour. New callers should use `buildCorsHeaders(req, opts)`.
export const corsHeaders: Record<string, string> = {
  ...BASE_HEADERS,
  'Access-Control-Allow-Origin': '*',
};

export interface CorsOpts {
  /** Set true for endpoints called with credentials (sendBeacon, cookies). */
  credentials?: boolean;
}

export function buildCorsHeaders(req?: Request, opts: CorsOpts = {}): Record<string, string> {
  if (!opts.credentials || !req) {
    return { ...corsHeaders };
  }
  const origin = req.headers.get('origin');
  const allow = isAllowedOrigin(origin) ? origin! : 'null';
  return {
    ...BASE_HEADERS,
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  };
}

export function corsPreflight(req?: Request, opts: CorsOpts = {}): Response {
  return new Response('ok', { headers: buildCorsHeaders(req, opts) });
}

export function jsonResponse(
  data: unknown,
  init: ResponseInit = {},
  req?: Request,
  opts: CorsOpts = {},
): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      ...buildCorsHeaders(req, opts),
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

export function generateErrorId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `err_${Date.now().toString(36)}_${rand}`;
}

export function errorResponse(
  message: string,
  status = 500,
  extra?: Record<string, unknown>,
  req?: Request,
  opts: CorsOpts = {},
): Response {
  const code = (extra && typeof extra.code === 'string') ? extra.code : 'INTERNAL_ERROR';
  const errorId = (extra && typeof extra.errorId === 'string')
    ? extra.errorId as string
    : generateErrorId();
  try { console.error(`[${errorId}] ${code} ${status}: ${message}`); } catch { /* noop */ }
  return jsonResponse(
    { code, error: code, message, errorId, ...(extra || {}) },
    { status, headers: { 'x-error-id': errorId } },
    req,
    opts,
  );
}
