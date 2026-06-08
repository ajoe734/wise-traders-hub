// Structured logger for edge functions.
//
// One line of JSON per log call (level, fn, requestId, msg, optional meta).
// Lets you grep function logs by `requestId` and aggregate by level without
// regexing free-form `console.log` strings.
//
//   const log = createLogger('knowledge-backtest');
//   log.info('start', { mode: 'single', itemId });
//   log.error('db_error', { code: error.code });
//
// For a full request lifecycle wrapper, use `withLogging`:
//
//   export default withLogging('my-fn', async (req, log) => {
//     log.info('parsed', { body });
//     return jsonResponse({ ok: true });
//   });

type Meta = Record<string, unknown>;
type Level = 'debug' | 'info' | 'warn' | 'error';

export interface EdgeLogger {
  fn: string;
  requestId: string;
  debug: (msg: string, meta?: Meta) => void;
  info: (msg: string, meta?: Meta) => void;
  warn: (msg: string, meta?: Meta) => void;
  error: (msg: string, meta?: Meta) => void;
  child: (extra: Meta) => EdgeLogger;
}

function safeUuid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function emit(level: Level, fn: string, requestId: string, msg: string, meta?: Meta, base?: Meta) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    fn,
    requestId,
    msg,
    ...(base || {}),
    ...(meta || {}),
  };
  const line = JSON.stringify(payload);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export function createLogger(fn: string, requestId?: string, base?: Meta): EdgeLogger {
  const rid = requestId || safeUuid();
  const baseMeta = base || {};
  return {
    fn,
    requestId: rid,
    debug: (msg, meta) => emit('debug', fn, rid, msg, meta, baseMeta),
    info: (msg, meta) => emit('info', fn, rid, msg, meta, baseMeta),
    warn: (msg, meta) => emit('warn', fn, rid, msg, meta, baseMeta),
    error: (msg, meta) => emit('error', fn, rid, msg, meta, baseMeta),
    child: (extra) => createLogger(fn, rid, { ...baseMeta, ...extra }),
  };
}

/**
 * Higher-order request handler: assigns a requestId, logs start/end + duration,
 * catches uncaught errors and returns a sane 500 with CORS preserved.
 *
 * R5 — cold-start observability: on the first invocation after process boot,
 * fires a fire-and-forget INSERT into `edge_boot_events` so ops-health can
 * show cold-start frequency per function.
 */
import { corsHeaders, corsPreflight, errorResponse } from './cors.ts';

export type LoggedHandler = (req: Request, log: EdgeLogger) => Promise<Response>;

// Module-scoped: survive across warm invocations, reset on cold start.
const BOOT_AT = Date.now();
let INVOCATION_COUNT = 0;
let BOOT_EVENT_REPORTED = false;

async function reportBootEvent(fn: string, log: EdgeLogger) {
  if (BOOT_EVENT_REPORTED) return;
  BOOT_EVENT_REPORTED = true;
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) return;
    const region = Deno.env.get('SB_REGION') || Deno.env.get('DENO_REGION') || null;
    const deploymentId = Deno.env.get('SB_EXECUTION_ID') || Deno.env.get('DENO_DEPLOYMENT_ID') || null;
    await fetch(`${url}/rest/v1/edge_boot_events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ fn, region, deployment_id: deploymentId }),
    });
  } catch (err) {
    log.warn('boot_event_insert_failed', { message: err instanceof Error ? err.message : String(err) });
  }
}

export function withLogging(fn: string, handler: LoggedHandler): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === 'OPTIONS') return corsPreflight();
    const requestId = req.headers.get('x-correlation-id') || undefined;
    const log = createLogger(fn, requestId);
    const startedAt = performance.now();
    INVOCATION_COUNT += 1;
    const invocation = INVOCATION_COUNT;
    const cold = invocation === 1;
    const bootAgeMs = Date.now() - BOOT_AT;
    log.info('start', { method: req.method, url: req.url, cold, invocation, bootAgeMs });
    if (cold) {
      // Don't await — never block the request on telemetry.
      reportBootEvent(fn, log).catch(() => {});
    }
    try {
      const res = await handler(req, log);
      const ms = Math.round(performance.now() - startedAt);
      log.info('end', { status: res.status, ms, invocation });
      // Make sure correlation id propagates back to client.
      const headers = new Headers(res.headers);
      if (!headers.has('x-correlation-id')) headers.set('x-correlation-id', log.requestId);
      for (const [k, v] of Object.entries(corsHeaders)) if (!headers.has(k)) headers.set(k, v);
      return new Response(res.body, { status: res.status, headers });
    } catch (err) {
      const ms = Math.round(performance.now() - startedAt);
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      log.error('uncaught', { ms, message, stack, invocation });
      return errorResponse(message, 500, { requestId: log.requestId });
    }
  };
}
