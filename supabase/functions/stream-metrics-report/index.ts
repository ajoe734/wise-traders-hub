// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
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
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { withLogging } from '../_shared/edgeLogger.ts';
import { serviceClient } from '../_shared/supabaseClients.ts';

// 需要被 alerts-watchdog 統計的終止類型（timeout/abort/error）：
// 一併寫入 function_run_logs（level=warn），供 30 分鐘視窗聚合。
const PERSIST_TERMINATED = new Set(['abort', 'timeout', 'error']);

const ALLOWED_TERMINATED = new Set(['finish', 'abort', 'timeout', 'eof', 'error']);
const MAX_SOURCE_LEN = 120;
const MAX_TESTNAME_LEN = 200;
const MAX_EXTRA_KEYS = 12;
const MAX_EXTRA_VALUE_LEN = 200;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function asUuidOrNull(v: unknown): string | null {
  return typeof v === 'string' && UUID_RE.test(v) ? v : null;
}

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
  // AUTH: cron (Phase M-2 runtime enforcement)
  if (req.method !== 'OPTIONS') {
    try { requireCronKey(req); }
    catch (e) {
      if (e instanceof AuthError) {
        return new Response(JSON.stringify({ error: e.message, code: e.code }), {
          status: e.status,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      throw e;
    }
  }

  if (req.method === 'OPTIONS') return corsPreflight();
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

  const shortStr = (v: unknown, len = 100) =>
    typeof v === 'string' && v.length ? v.slice(0, len) : null;

  // 追蹤鏈：correlationId 為主鍵；requestId（client 端 fetch 建立時就決定的 uuid）
  // 為次鍵，用來把「同一次 UI action → transport fetch → edge 收到 request」串在一起。
  // 若 caller 沒帶 correlationId，直接把 requestId 升級成 correlationId，讓後續
  // alerts-watchdog / stream-health 的 run_id 一律可以撿到值。
  // 同時 header 若有 x-correlation-id / x-request-id 也一併接進來（withLogging 已把
  // x-correlation-id 對應到 log.requestId，這裡再撈一次 x-request-id 當 client requestId）。
  const headerCorrelationId = req.headers.get('x-correlation-id');
  const headerRequestId = req.headers.get('x-request-id');
  const requestId = shortStr(body.requestId) ?? shortStr(headerRequestId) ?? log.requestId;
  const correlationId =
    shortStr(body.correlationId) ?? shortStr(headerCorrelationId) ?? requestId;

  const errorId = shortStr(body.errorId);
  const sessionId = shortStr(body.sessionId, 120);
  const userId = shortStr(body.userId, 64);
  const expertId = shortStr(body.expertId, 64);
  const clientVersion = shortStr(body.clientVersion, 60);
  const userAgent = shortStr(body.userAgent, 200);
  const testName = typeof body.testName === 'string' ? body.testName.slice(0, MAX_TESTNAME_LEN) : null;
  const contentType = shortStr(body.contentType, 120);
  const extra = sanitizeExtra(body.extra);

  const meta = {
    source,
    terminatedBy,
    rawTerminated: terminatedBy === 'invalid' ? rawTerminated.slice(0, 40) : undefined,
    eventCount,
    elapsedMs,
    // 追蹤鏈：這 5 個欄位是 join key。log 面板可用任一個交叉查。
    correlationId,
    requestId,
    sessionId,
    userId,
    expertId,
    errorId,
    clientVersion,
    userAgent,
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

  // 針對 abort/timeout/error，寫入 function_run_logs 讓 alerts-watchdog 可以
  // 30 分鐘視窗聚合並在超過閾值時開告警。fire-and-forget，不阻塞 caller。
  // run_id 一律用 correlationId（後備為 requestId），確保同一條追蹤鏈的所有記錄
  // 都能在 `SELECT ... WHERE run_id = ?` 撈到。
  if (PERSIST_TERMINATED.has(terminatedBy)) {
    try {
      const admin = serviceClient();
      admin.from('function_run_logs').insert({
        fn: 'stream-metrics-report',
        run_id: correlationId,
        level: 'warn',
        stage: `stream_${terminatedBy}`,
        msg: `stream terminated by ${terminatedBy}`,
        expert_id: asUuidOrNull(expertId),
        payload: {
          source,
          terminatedBy,
          eventCount,
          elapsedMs,
          correlationId,
          requestId,
          sessionId,
          userId,
          expertId,
          errorId,
          clientVersion,
          userAgent,
          contentType,
          testName,
          extra,
        },
      }).then(({ error }) => {
        if (error) log.warn('persist_failed', { message: error.message });
      });
    } catch (err) {
      log.warn('persist_skipped', { message: err instanceof Error ? err.message : String(err) });
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      terminatedBy,
      eventCount,
      elapsedMs,
      correlationId,
      requestId,
    }),
    {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        // 回一個 x-correlation-id，讓 client 若沒帶自己的 id，也能拿回 endpoint 選定的那把 key。
        'x-correlation-id': correlationId,
      },
    },
  );
}));

