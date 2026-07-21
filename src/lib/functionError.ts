export interface FunctionFailure {
  message: string;
  detail?: string;
  code?: string;
  status?: number;
  requestId?: string;
  source: 'edge' | 'network' | 'payload' | 'database' | 'unknown';
}

async function readErrorContext(error: unknown): Promise<{ body?: any; text?: string; status?: number; requestId?: string }> {
  const context = (error as any)?.context as Response | undefined;
  if (!context) return {};

  const requestId = context.headers?.get?.('x-correlation-id') || context.headers?.get?.('x-request-id') || undefined;
  const status = typeof context.status === 'number' ? context.status : undefined;

  try {
    const body = await context.clone().json();
    return { body, status, requestId: body?.request_id || body?.requestId || requestId };
  } catch {
    try {
      const text = await context.clone().text();
      return { text, status, requestId };
    } catch {
      return { status, requestId };
    }
  }
}

export async function describeFunctionFailure(
  data: any,
  error: unknown,
  fallback = '操作失敗',
): Promise<FunctionFailure | null> {
  if (!error && !data?.error && data?.ok !== false) return null;

  const parsed = error ? await readErrorContext(error) : {};
  const body = parsed.body || data || {};
  const rawMessage = body?.error || body?.message || (error as any)?.message || fallback;
  const genericNon2xx = rawMessage === 'Edge Function returned a non-2xx status code';
  const textDetail = parsed.text && parsed.text !== rawMessage ? parsed.text.slice(0, 600) : undefined;
  const message = genericNon2xx
    ? body?.error || body?.message || textDetail || fallback
    : rawMessage;

  return {
    message,
    detail: body?.detail || textDetail,
    code: body?.code,
    status: parsed.status || body?.status,
    requestId: body?.request_id || body?.requestId || parsed.requestId,
    source: error ? ((error as any)?.name === 'FunctionsFetchError' ? 'network' : 'edge') : 'payload',
  };
}

export function describeDbFailure(error: any, fallback = '資料更新失敗'): FunctionFailure | null {
  if (!error) return null;
  return {
    message: error.message || fallback,
    detail: error.details || error.hint,
    code: error.code,
    source: 'database',
  };
}

export function formatFailure(failure: FunctionFailure | null, fallback = '操作失敗'): string {
  if (!failure) return fallback;
  const tags = [failure.code, failure.status ? `HTTP ${failure.status}` : null, failure.requestId ? `req ${failure.requestId.slice(0, 8)}` : null].filter(Boolean);
  return tags.length ? `${failure.message}（${tags.join(' · ')}）` : failure.message;
}