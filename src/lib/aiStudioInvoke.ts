// AI Studio / Training edge function invoker with full debug tracing.
//
// 每次呼叫會：
//   1) 產生一個 clientRequestId (uuid) 塞進 x-request-id / x-correlation-id
//   2) 從 response header 拿回 server 側的 x-correlation-id / x-error-id
//   3) 若後端回 { ok: false, ... } 或 non-2xx，攤平成 EdgeCallError
//   4) toast 用的 formatEdgeError() 會把 message + code + stage + requestId + errorId
//      合成一行給老師直接回報，工程師從 log 用 requestId 反查
//
// 使用：
//   import { edgeCall, formatEdgeError } from '@/lib/aiStudioInvoke';
//   try {
//     const res = await edgeCall('expert-ai-studio', 'add_chunk', expertId, { content });
//   } catch (e) {
//     toast.error(formatEdgeError(e, '新增失敗'));
//   }

import { supabase } from '@/integrations/supabase/client';

export interface EdgeDebugInfo {
  requestId?: string;      // 前端產的 client request id（== x-correlation-id）
  correlationId?: string;  // server echo 回來的追蹤 id（一般等於 requestId）
  errorId?: string;        // errorResponse() 產的短碼 err_xxx
  code?: string;           // 業務 error code（INTERNAL_ERROR / ...）
  stage?: string;          // embed / re_embed / gen / insert ...
  action?: string;         // 對應 edge function 的 action
  status?: number;         // HTTP status
  candidateId?: string;    // 失敗的候選條目 id（審核/採納時）
  raw?: unknown;
}

export class EdgeCallError extends Error {
  debug: EdgeDebugInfo;
  constructor(message: string, debug: EdgeDebugInfo = {}) {
    super(message);
    this.name = 'EdgeCallError';
    this.debug = debug;
  }
}

function newClientRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

async function readBody(ctx: unknown): Promise<any> {
  // Supabase-js FunctionsHttpError puts the Response in `context`.
  if (ctx && typeof (ctx as Response).json === 'function') {
    try { return await (ctx as Response).clone().json(); } catch { /* not JSON */ }
    try { return { message: await (ctx as Response).clone().text() }; } catch { /* noop */ }
  }
  return null;
}

export async function edgeCall<T = any>(
  fn: string,
  action: string,
  expertId: string,
  extra: Record<string, unknown> = {},
): Promise<T & { _debug: EdgeDebugInfo }> {
  const clientRequestId = newClientRequestId();
  const { data, error } = await supabase.functions.invoke(fn, {
    body: { action, expert_id: expertId, ...extra },
    headers: {
      'x-request-id': clientRequestId,
      'x-correlation-id': clientRequestId,
    },
  });

  if (error) {
    const body = await readBody((error as any).context);
    const status = (error as any).context?.status as number | undefined;
    throw new EdgeCallError(
      body?.message || error.message || 'edge call failed',
      {
        requestId: clientRequestId,
        correlationId: body?.requestId || clientRequestId,
        errorId: body?.errorId,
        code: body?.code,
        stage: body?.stage,
        action: body?.action || action,
        status,
        raw: body,
      },
    );
  }

  if (!data || data.ok === false) {
    throw new EdgeCallError(
      data?.message || 'failed',
      {
        requestId: clientRequestId,
        correlationId: data?.requestId || clientRequestId,
        errorId: data?.errorId,
        code: data?.code,
        stage: data?.stage,
        action: data?.action || action,
        raw: data,
      },
    );
  }

  return {
    ...(data as T),
    _debug: { requestId: clientRequestId, correlationId: data?.requestId || clientRequestId, action },
  };
}

/**
 * 產出「工程師/老師都看得懂」的 toast 文案：
 *   標題：儲存失敗
 *   原因：AI Gateway 429 rate limit
 *   [embed · err_lz8k_abc123 · req 5f2c…]
 */
export function formatEdgeError(err: unknown, fallback = '操作失敗'): string {
  if (err instanceof EdgeCallError) {
    const { stage, errorId, requestId, code, candidateId, status } = err.debug;
    const tag: string[] = [];
    if (stage) tag.push(stage);
    if (code && code !== 'INTERNAL_ERROR') tag.push(code);
    if (status && status !== 500) tag.push(`HTTP ${status}`);
    if (candidateId) tag.push(`cand ${candidateId.slice(0, 8)}`);
    if (errorId) tag.push(errorId);
    if (requestId) tag.push(`req ${requestId.slice(0, 8)}`);
    const suffix = tag.length ? `\n[${tag.join(' · ')}]` : '';
    return `${fallback}：${err.message}${suffix}`;
  }
  const anyE = err as any;
  return `${fallback}：${anyE?.message || String(err)}`;
}

/** 給 UI 顯示追蹤鏈的小 badge 元件用的純資料。 */
export function debugOf(err: unknown): EdgeDebugInfo | null {
  return err instanceof EdgeCallError ? err.debug : null;
}
