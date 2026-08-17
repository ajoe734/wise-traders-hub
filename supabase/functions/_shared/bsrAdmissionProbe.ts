/**
 * bsrAdmissionProbe — server-side FinMind probe（Stage B v6 §4）。
 *
 * 憲法級規則：
 *   - probe **一定** 由伺服器自己打 provider。caller（就算是 company_admin）
 *     **不得** 提供 success / evidence / provider response 的任何欄位；
 *     這支的介面根本不接受那些輸入。
 *   - production 預設 official URL；只有測試環境（BSR_PROBE_ALLOW_LOCAL=1 且
 *     目標為 loopback）才允許用注入的 base URL。
 *   - 回傳 evidence 是**組出來**的白名單欄位，不含 token / URL / raw body。
 *   - 只有 HTTP 200 且 row_count>0 才算 success；429 / 5xx / network / terminal
 *     一律 success=false，呼叫端不得 unblock。
 */

import { classifyProviderError, sanitizeText } from './bsrAdmissionGate.ts';

export const OFFICIAL_FINMIND_URL = 'https://api.finmindtrade.com/api/v4/data';
export const PROBE_SCHEMA_VERSION = '1';

export interface ProbeOptions {
  /** 探測用的代號（白名單過的四碼台股） */
  stockId: string;
  /** 探測日（YYYY-MM-DD） */
  tradeDate: string;
  token: string;
  /** 注入點：測試用。production 不傳 → official URL */
  baseUrl?: string;
  allowLocal?: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface ProbeResult {
  success: boolean;
  /** 可安全寫進 DB / log 的 evidence（通過 assert_sanitized） */
  evidence: Record<string, unknown>;
  /** 分類結果：terminal / retryable / unknown / none */
  outcome: 'ok' | 'terminal' | 'retryable' | 'unknown';
  httpStatus: number | null;
  /** sanitize 過的失敗說明 */
  error: string | null;
}

function isLoopback(u: string): boolean {
  try {
    const h = new URL(u).hostname;
    return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '0.0.0.0';
  } catch { return false; }
}

/** 決定實際要打的 URL；非 loopback 的注入一律忽略，退回 official。 */
export function resolveProbeUrl(baseUrl?: string, allowLocal?: boolean): {
  url: string;
  source: 'official' | 'injected_local';
} {
  if (baseUrl && allowLocal && isLoopback(baseUrl)) {
    return { url: baseUrl, source: 'injected_local' };
  }
  return { url: OFFICIAL_FINMIND_URL, source: 'official' };
}

/** 從 provider 回應組 evidence；只放白名單欄位。 */
export function buildEvidence(input: {
  httpStatus: number | null;
  rowCount: number;
  stockId: string;
  tradeDate: string;
  urlSource: 'official' | 'injected_local';
  elapsedMs: number;
  note?: string | null;
}): Record<string, unknown> {
  const e: Record<string, unknown> = {
    admission_probe_schema_version: PROBE_SCHEMA_VERSION,
    probe_at: new Date().toISOString(),
    provider: 'finmind',
    dataset: 'TaiwanStockTradingDailyReport',
    http_status: String(input.httpStatus ?? 0),
    sample_stock_id: String(input.stockId),
    sample_trade_date: String(input.tradeDate),
    sample_row_count: String(Math.max(0, Number(input.rowCount) || 0)),
    endpoint_source: input.urlSource,
    elapsed_ms: Math.max(0, Math.round(input.elapsedMs)),
  };
  if (input.note) e.note = sanitizeText(input.note, 160);
  return e;
}

/**
 * 實際打一次最小 probe。任何例外都被吞成 success=false（不 throw 給 handler）。
 */
export async function runProviderProbe(opts: ProbeOptions): Promise<ProbeResult> {
  const { url, source } = resolveProbeUrl(opts.baseUrl, opts.allowLocal);
  const doFetch = opts.fetchImpl ?? fetch;
  const started = Date.now();
  const qs = new URLSearchParams({
    dataset: 'TaiwanStockTradingDailyReport',
    data_id: opts.stockId,
    start_date: opts.tradeDate,
    end_date: opts.tradeDate,
  });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), Math.max(1000, opts.timeoutMs ?? 15_000));

  try {
    const res = await doFetch(`${url}?${qs.toString()}`, {
      headers: opts.token ? { Authorization: `Bearer ${opts.token}` } : {},
      signal: ctl.signal,
    });
    const status = res.status;
    const text = await res.text();

    if (status !== 200) {
      const cls = classifyProviderError(`http_${status}:${text}`);
      return {
        success: false,
        evidence: buildEvidence({
          httpStatus: status, rowCount: 0, stockId: opts.stockId,
          tradeDate: opts.tradeDate, urlSource: source,
          elapsedMs: Date.now() - started,
          note: cls.code ?? 'provider_error',
        }),
        outcome: cls.outcome === 'terminal' ? 'terminal'
          : cls.outcome === 'retryable' ? 'retryable' : 'unknown',
        httpStatus: status,
        error: sanitizeText(`http_${status}:${cls.code ?? 'unclassified'}`, 120),
      };
    }

    let rows: unknown[] = [];
    let parseNote: string | null = null;
    try {
      const j = JSON.parse(text) as { data?: unknown; msg?: string; status?: number };
      // FinMind 會用 HTTP 200 + body.status=400 回方案拒絕。
      if (typeof j?.status === 'number' && j.status >= 400) {
        const cls = classifyProviderError(`http_${j.status}:${j.msg ?? ''}`);
        return {
          success: false,
          evidence: buildEvidence({
            httpStatus: j.status, rowCount: 0, stockId: opts.stockId,
            tradeDate: opts.tradeDate, urlSource: source,
            elapsedMs: Date.now() - started, note: cls.code ?? 'provider_error',
          }),
          outcome: cls.outcome === 'terminal' ? 'terminal'
            : cls.outcome === 'retryable' ? 'retryable' : 'unknown',
          httpStatus: j.status,
          error: sanitizeText(`body_status_${j.status}:${cls.code ?? 'unclassified'}`, 120),
        };
      }
      rows = Array.isArray(j?.data) ? (j.data as unknown[]) : [];
    } catch {
      parseNote = 'invalid_json';
    }

    const rowCount = rows.length;
    const success = parseNote === null && rowCount > 0;
    return {
      success,
      evidence: buildEvidence({
        httpStatus: 200, rowCount, stockId: opts.stockId, tradeDate: opts.tradeDate,
        urlSource: source, elapsedMs: Date.now() - started,
        note: parseNote ?? (success ? null : 'empty_dataset'),
      }),
      outcome: success ? 'ok' : 'unknown',
      httpStatus: 200,
      error: success ? null : (parseNote ?? 'empty_dataset'),
    };
  } catch (e) {
    const msg = (e as Error)?.name === 'AbortError' ? 'timeout' : ((e as Error)?.message ?? 'network');
    const cls = classifyProviderError(msg);
    return {
      success: false,
      evidence: buildEvidence({
        httpStatus: null, rowCount: 0, stockId: opts.stockId, tradeDate: opts.tradeDate,
        urlSource: source, elapsedMs: Date.now() - started,
        note: cls.code ?? 'upstream_network',
      }),
      outcome: cls.outcome === 'retryable' ? 'retryable' : 'unknown',
      httpStatus: null,
      error: sanitizeText(msg, 120),
    };
  } finally {
    clearTimeout(timer);
  }
}
