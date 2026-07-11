// 串流可觀察性上報端點
//
// 接收 parseAndValidateUiStream（或 client 端 useExpertAiChat）的終止資訊：
//   { source, eventCount, terminatedBy, elapsedMs, correlationId?, testName?, extra? }
// 用 withLogging 以結構化 JSON 落到 Edge Function Logs，之後可用
// `edge_function_logs stream-metrics-report --search terminatedBy` 直接排查
// chunk 洩漏或協議漂移（例如某天 finish 後仍持續冒 chunk / eventCount 突增 / elapsedMs 尾巴變長）。
//
// 設計原則：
//   - 不寫 DB、不需 JWT，最快落地；純觀察性用途。
//   - 只接受白名單欄位，避免 caller 灌一堆 payload 進 log。
//   - terminatedBy 僅允許 finish/abort/timeout/eof/error，其他一律標記為 "invalid"。

import { corsHeaders, corsPreflight, errorResponse } from '../_shared/cors.ts';
import { withLogging } from '../_shared/edgeLogger.ts';

const ALLOWED_TERMINATED = new Set(['finish', 'abort', 'timeout', 'eof', 'error']);
const MAX_SOURCE_LEN = 120;
const MAX_TESTNAME_LEN = 200;
const MAX_EXTRA_KEYS = 12;
const MAX_EXTRA_VALUE_LEN = 200;

function sanitizeExtra(extra: unknown): Record<string, string | number | boolean> | undefined {
  if (!extra || typeof extra !== 'object') return undefined;
  const out: Record<string, string | number | boolean> = {};
  let count = 0;
  for (const [k, v] of Object.entries(extra as Record<string, unknown>)) {
    if (count >= MAX_EXTRA_KEYS) break;
    if (typeof k !== 'string' || k.length > 64) continue;
    if (typeof v === 'number' && Number.isFinite(v)) { out[k] = v; count++; continue; }
    if (typeof v === 'boolean') { out[k] = v; count++; continue; }
    if (typeof v === 'string') { out[k] = v.slice(0, MAX_EXTRA_VALUE_LEN); count++; continue; }
    // 其他型別（物件/陣列）忽略，避免 log 爆
  }
  return Object.keys(out).length ? out : undefined;
}

Deno.serve(withLogging('stream-metrics-report', async (req, log) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return errorResponse('method not allowed', 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse('invalid json body', 400);
  }
  if (!body || typeof body !== 'object') return errorResponse('body must be object', 400);

  const source = typeof body.source === 'string' ? body.source.slice(0, MAX_SOURCE_LEN) : 'unknown';
  const rawTerminated = typeof body.terminatedBy === 'string' ? body.terminatedBy : '';
  const terminatedBy = ALLOWED_TERMINATED.has(rawTerminated) ? rawTerminated : 'invalid';
  const eventCount = Number.isFinite(body.eventCount) ? Math.max(0, Math.floor(body.eventCount)) : -1;
  const elapsedMs = Number.isFinite(body.elapsedMs) ? Math.max(0, Math.floor(body.elapsedMs)) : -1;
  const correlationId = typeof body.correlationId === 'string' ? body.correlationId.slice(0, 100) : null;
  const errorId = typeof body.errorId === 'string' ? body.errorId.slice(0, 100) : null;
  const testName = typeof body.testName === 'string' ? body.testName.slice(0, MAX_TESTNAME_LEN) : null;
  const contentType = typeof body.contentType === 'string' ? body.contentType.slice(0, 120) : null;
  const extra = sanitizeExtra(body.extra);

  const meta = {
    source,
    terminatedBy,
    rawTerminated: terminatedBy === 'invalid' ? rawTerminated.slice(0, 40) : undefined,
    eventCount,
    elapsedMs,
    correlationId,
    errorId,
    testName,
    contentType,
    extra,
  };

  // 用 warn 讓 finish 以外的異常（尤其 invalid / 超長 elapsedMs / eventCount 為 0）
  // 在 log 面板一眼看得到；正常 finish 走 info。
  const level: 'info' | 'warn' = (terminatedBy === 'finish' || terminatedBy === 'eof') ? 'info' : 'warn';
  if (level === 'warn') {
    log.warn('stream_metrics', meta);
  } else {
    log.info('stream_metrics', meta);
  }

  return new Response(
    JSON.stringify({ ok: true, terminatedBy, eventCount, elapsedMs }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}));
