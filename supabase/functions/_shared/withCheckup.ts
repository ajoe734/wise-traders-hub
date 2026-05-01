// Shared middleware for checkup edge functions.
// Centralizes CORS, JWT auth, optional quota consumption, and Zod-style schema validation.
//
// Usage:
//   import { withCheckup, json } from '../_shared/withCheckup.ts';
//   Deno.serve(withCheckup(async ({ req, body, userId, quota }) => {
//     return json({ ok: true });
//   }, { auth: true, quota: 'analysis', schema: BodySchema }));

import { consumeCheckupQuota, type QuotaResult } from './checkupQuota.ts';

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-correlation-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

export function errorJson(
  error: string,
  status = 400,
  extra: Record<string, unknown> = {},
): Response {
  return json({ error, ...extra }, { status });
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

export interface CheckupContext<TBody = unknown> {
  req: Request;
  body: TBody;
  userId: string | null;
  jwt: string | null;
  quota?: QuotaResult['quota'];
  correlationId: string;
}

interface SchemaLike<T> {
  safeParse: (input: unknown) => { success: true; data: T } | { success: false; error: unknown };
}

export interface WithCheckupOptions<TBody = unknown> {
  /** Require valid JWT. Default: true. Set false for public endpoints. */
  auth?: boolean;
  /** If set, atomically consume one quota credit of this kind before handler runs. Implies auth=true. */
  quota?: string | false;
  /** Optional Zod-compatible schema applied to JSON body (POST). */
  schema?: SchemaLike<TBody>;
  /** Allowed methods. Default: ['POST','OPTIONS']. */
  methods?: string[];
}

type Handler<TBody> = (ctx: CheckupContext<TBody>) => Promise<Response> | Response;

async function resolveUserId(jwt: string): Promise<string | null> {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${jwt}`, apikey: SERVICE_ROLE_KEY },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.id || null;
  } catch {
    return null;
  }
}

export function withCheckup<TBody = unknown>(
  handler: Handler<TBody>,
  opts: WithCheckupOptions<TBody> = {},
): (req: Request) => Promise<Response> {
  const requireAuth = opts.auth !== false || !!opts.quota;
  const allowedMethods = opts.methods ?? ['POST', 'OPTIONS'];

  return async (req: Request): Promise<Response> => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }

    if (!allowedMethods.includes(req.method)) {
      return errorJson('METHOD_NOT_ALLOWED', 405);
    }

    const correlationId =
      req.headers.get('x-correlation-id') ||
      crypto.randomUUID().slice(0, 8);

    // Auth
    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim() || null;
    let userId: string | null = null;

    if (requireAuth) {
      if (!jwt) {
        return errorJson('AUTH_REQUIRED', 401, {
          message: '請先登入再使用此功能',
        });
      }
    }

    // Quota (also resolves userId)
    let quotaSnapshot: QuotaResult['quota'] | undefined;
    if (opts.quota) {
      const result = await consumeCheckupQuota(req, opts.quota, corsHeaders);
      if (!result.ok) {
        return new Response(
          JSON.stringify(result.body || { error: 'QUOTA_CHECK_FAILED' }),
          {
            status: result.status || 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        );
      }
      userId = result.userId || null;
      quotaSnapshot = result.quota;
    } else if (requireAuth && jwt) {
      userId = await resolveUserId(jwt);
      if (!userId) {
        return errorJson('AUTH_INVALID', 401);
      }
    }

    // Body parsing + validation (POST only)
    let body: unknown = undefined;
    if (req.method === 'POST') {
      try {
        const text = await req.text();
        body = text ? JSON.parse(text) : {};
      } catch {
        return errorJson('INVALID_JSON', 400);
      }

      if (opts.schema) {
        const parsed = opts.schema.safeParse(body);
        if (!parsed.success) {
          return errorJson('VALIDATION_FAILED', 400, {
            // deno-lint-ignore no-explicit-any
            details: (parsed as any).error?.issues ?? (parsed as any).error,
          });
        }
        body = parsed.data;
      }
    }

    // Handler with global error capture
    try {
      const res = await handler({
        req,
        body: body as TBody,
        userId,
        jwt,
        quota: quotaSnapshot,
        correlationId,
      });

      // Ensure CORS on every response
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(corsHeaders)) {
        if (!headers.has(k)) headers.set(k, v);
      }
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers,
      });
    } catch (err) {
      console.error(`[withCheckup:${correlationId}] handler error`, err);
      return errorJson('INTERNAL_ERROR', 500, {
        message: err instanceof Error ? err.message : String(err),
        correlationId,
      });
    }
  };
}
