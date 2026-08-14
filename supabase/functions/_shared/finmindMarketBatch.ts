// _shared/finmindMarketBatch.ts
// M3 v2 — L1 Coalesced Market Fetch
//
// 一次抓取 FinMind TaiwanStockTradingDailyReport 整市場當日資料（省略 data_id）。
// 若 API sponsor plan 支援，1 quota = 整個交易日全部分點資料（~1600 檔 × ~15 broker）；
// 效益：處理 20 檔 = 1 quota；處理 500 檔 = 1 quota；quota 消耗與 job 數量完全解耦。
//
// 探測（probe）：上線前用 real FINMIND_TOKEN 打一次無 data_id 的呼叫；
// 若回應涵蓋 >= min_stocks_in_response（預設 500）家 → 標記 supported=true；
// 否則 supported=false，index.ts 走 per-stock fallback（M2 舊路徑）。
// 結果寫入 tw_bsr_sync_config[key='market_batch'].config.supported，
// 也提供 kill switch（config.enabled=false 立刻降回 per-stock）。

import type { SupabaseClient } from './supabaseClients.ts';
import { fetchWithRateLimit } from './finmindRateLimit.ts';
import type { FinmindRow } from '../tw-bsr-finmind-sync/lib.ts';

const FINMIND_URL = 'https://api.finmindtrade.com/api/v4/data';
/** M1：sponsorpro 專屬整日全市場 parquet 端點（只做 capability probe，不 ingest）。 */
const FINMIND_STORAGE_OBJECTS_URL = 'https://api.finmindtrade.com/api/v4/storage_objects';
const FINMIND_TOKEN = Deno.env.get('FINMIND_TOKEN') ?? '';
/** content-length 超過此值直接放棄，不讀 body。 */
export const MAX_BULK_BYTES = 80 * 1024 * 1024;
/** probe 只允許從 body 讀這麼多 bytes（含 JSON / 錯誤訊息）。 */
export const MAX_PROBE_BYTES = 64 * 1024;

export type ProbeFormat = 'parquet' | 'signed_url_unverified' | null;

export interface MarketBatchConfig {
  enabled: boolean;
  supported: boolean | null;
  probed_at: string | null;
  min_stocks_in_response: number;
  threshold_pending: number;
  /** 診斷欄位（tri-state probe）；不影響 canMarketBatch 判定。 */
  last_probe_outcome?: 'supported' | 'unsupported' | 'inconclusive' | null;
  last_probe_at?: string | null;
  last_probe_error?: string | null;
  /** M1 診斷：probe 觀察到的回應格式（不含任何 signed URL）。 */
  last_probe_format?: ProbeFormat;
}

const DEFAULT_CONFIG: MarketBatchConfig = {
  enabled: true,
  supported: null,
  probed_at: null,
  min_stocks_in_response: 500,
  threshold_pending: 15,
  last_probe_outcome: null,
  last_probe_at: null,
  last_probe_error: null,
  last_probe_format: null,
};


export async function loadMarketBatchConfig(supa: SupabaseClient): Promise<MarketBatchConfig> {
  const { data } = await supa.from('tw_bsr_sync_config')
    .select('config').eq('key', 'market_batch').maybeSingle();
  const cfg = (data as any)?.config ?? {};
  return { ...DEFAULT_CONFIG, ...cfg };
}

export async function updateMarketBatchConfig(
  supa: SupabaseClient,
  patch: Partial<MarketBatchConfig>,
): Promise<void> {
  const cur = await loadMarketBatchConfig(supa);
  const next = { ...cur, ...patch };
  await supa.from('tw_bsr_sync_config')
    .update({ config: next, updated_at: new Date().toISOString() })
    .eq('key', 'market_batch');
}

/**
 * Fetch one full market day. Uses tier=1 quota (a market batch fulfills tier1
 * pending holdings, so it charges the highest-priority bucket).
 *
 * @throws RateLimitExhaustedError when no quota can be reserved.
 */
export async function fetchFinmindMarketDay(
  supa: SupabaseClient,
  date: string,
  correlationId: string | null,
  tier: 1 | 2 | 3 = 1,
): Promise<FinmindRow[]> {
  const p = new URLSearchParams({
    dataset: 'TaiwanStockTradingDailyReport',
    start_date: date,
  });
  if (FINMIND_TOKEN) p.set('token', FINMIND_TOKEN);

  // Longer abort budget: market-wide response is ~5–8 MB.
  const res = await fetchWithRateLimit(
    supa,
    `${FINMIND_URL}?${p}`,
    { signal: AbortSignal.timeout(60_000) },
    { correlationId, tier, leaseSeconds: 70 },
  );
  // Phase-2: 記錄上游配額 header（若有）
  try {
    const { recordUpstreamQuota } = await import('./finmindUpstreamQuota.ts');
    await recordUpstreamQuota(supa, 'finmind_market_batch', res);
  } catch { /* non-fatal */ }
  const text = await res.text();
  if (!res.ok) throw new Error(`finmind_http_${res.status}:${text.slice(0, 200)}`);
  let j: any;
  try { j = JSON.parse(text); } catch { throw new Error(`finmind_bad_json:${text.slice(0, 200)}`); }
  if (j?.status !== 200 && !Array.isArray(j?.data)) {
    throw new Error(`finmind_api_${j?.status ?? 'unknown'}:${String(j?.msg ?? '').slice(0, 200)}`);
  }
  return Array.isArray(j.data) ? j.data : [];
}

/** Roll a date back to the nearest weekday (Sat/Sun → Friday). */
export function resolveProbeDate(base: Date = new Date(Date.now() - 3 * 86400_000)): string {
  // 以 UTC 判斷星期即可：probe 只需要「一個確定已結算的交易日」。
  const d = new Date(base.getTime());
  const dow = d.getUTCDay(); // 0=Sun, 6=Sat
  if (dow === 6) d.setUTCDate(d.getUTCDate() - 1); // Sat → Fri
  else if (dow === 0) d.setUTCDate(d.getUTCDate() - 2); // Sun → Fri
  return d.toISOString().slice(0, 10);
}

export type ProbeOutcome = 'supported' | 'unsupported' | 'inconclusive';

/** 判定錯誤是否為「方案/權限」層級的確定性 capability 失敗。 */
export function isCapabilityFailure(msg: string): boolean {
  const m = msg.toLowerCase();
  if (!m.startsWith('finmind_api_')) return false;
  return /permission|level|upgrade|not allowed|unauthor|forbidden|subscription/.test(m);
}

/** body 是否明示方案/權限限制（僅在 HTTP 401 分支「之後」才可比對）。 */
function looksPlanRestricted(text: string): boolean {
  return /sponsor|plan|upgrade|permission|not allowed|forbidden|subscription|level/i.test(text);
}

/** 純文字層 sanitizer：token / Bearer / signed URL / 長 token-like 字串。 */
function sanitizeText(input: string): string {
  let out = input;
  if (FINMIND_TOKEN) out = out.split(FINMIND_TOKEN).join('***');
  out = out
    .replace(/(Bearer\s+)\S+/gi, '$1***')
    .replace(/([A-Za-z0-9_-]*token[A-Za-z0-9_-]*\s*[=:]\s*)"?[^"&\s,}]+/gi, '$1***')
    .replace(/https?:\/\/\S*(?:sig|token|X-Amz|Signature)\S*/gi, '***')
    .replace(/[A-Za-z0-9_-]{20,}/g, '***');
  return out;
}

const SENSITIVE_KEY_RE = /^(token|access_token|api_key|apikey|authorization|secret|signed_url|url|token_tail)$/i;
const ALLOWED_KEY_RE = /^(msg|status|code|detail)$/i;

/** 遞迴遮罩 JSON：敏感 key 一律 ***；只保留白名單 key，且白名單值再跑文字 sanitizer。 */
function sanitizeJson(value: unknown, seen: WeakSet<object>, depth = 0): unknown {
  if (depth > 6) return '***';
  if (value === null || typeof value !== 'object') {
    return typeof value === 'string' ? sanitizeText(value) : value;
  }
  const obj = value as object;
  if (seen.has(obj)) return '***';
  seen.add(obj);
  if (Array.isArray(value)) return value.map((v) => sanitizeJson(v, seen, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_RE.test(k)) { out[k] = '***'; continue; }
    if (typeof v === 'object' && v !== null) { out[k] = sanitizeJson(v, seen, depth + 1); continue; }
    if (ALLOWED_KEY_RE.test(k)) { out[k] = typeof v === 'string' ? sanitizeText(v) : v; continue; }
    out[k] = '***';
  }
  return out;
}

/**
 * 統一 upstream 錯誤 sanitizer：JSON 走遞迴遮罩（敏感 key + 白名單），
 * 非 JSON 走純文字 sanitizer；一律截斷 300 字。
 */
export function sanitizeUpstreamError(msg: string): string {
  const raw = String(msg ?? '');
  // 嘗試抽出內嵌 JSON 片段（例如 "unsupported_plan:http_400:{...}"）
  const i = raw.indexOf('{');
  const j = raw.lastIndexOf('}');
  if (i >= 0 && j > i) {
    const prefix = sanitizeText(raw.slice(0, i));
    try {
      const parsed = JSON.parse(raw.slice(i, j + 1));
      return (prefix + JSON.stringify(sanitizeJson(parsed, new WeakSet()))).slice(0, 300);
    } catch { /* fall through */ }
  }
  return sanitizeText(raw).slice(0, 300);
}

/** @deprecated 用 sanitizeUpstreamError；保留為薄 wrapper 以維持既有匯出。 */
export function maskProbeError(msg: string): string {
  return sanitizeUpstreamError(msg);
}


/**
 * 從 response body 最多讀 `limit` bytes 後立即 cancel。
 * 嚴禁 res.text() / res.json() / res.arrayBuffer()（皆無上限）。
 */
export async function readBoundedBody(res: Response, limit = MAX_PROBE_BYTES): Promise<Uint8Array> {
  const body = res.body;
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      const take = Math.min(value.byteLength, limit - total);
      chunks.push(value.subarray(0, take));
      total += take;
    }
  } finally {
    try { await reader.cancel(); } catch { /* ignore */ }
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out;
}

/**
 * <= Taipei today 的 latest actual trading date（排除週末與 tw_market_holidays）。
 * 失敗時回 null，由呼叫端 fallback 既有 resolveProbeDate()。
 */
export async function resolveLatestTradingDate(supa: SupabaseClient): Promise<string | null> {
  try {
    const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
    const from = new Date(Date.now() + 8 * 3600_000 - 10 * 86400_000).toISOString().slice(0, 10);
    // deno-lint-ignore no-explicit-any
    const { data, error } = await (supa as any).rpc('tw_trading_days', { _from: from, _to: today });
    if (error || !Array.isArray(data) || data.length === 0) return null;
    const days = data
      .map((d: unknown) => (typeof d === 'string' ? d : (d as { tw_trading_days?: string })?.tw_trading_days))
      .filter((d: unknown): d is string => typeof d === 'string' && d.length >= 10)
      .map((d: string) => d.slice(0, 10))
      .sort();
    return days.length ? days[days.length - 1] : null;
  } catch {
    return null;
  }
}

export interface ProbeResult {
  supported: boolean;
  outcome: ProbeOutcome;
  stocks: number;
  probe_date?: string;
  sample?: string[];
  skipped?: string;
  error?: string;
}

interface StorageProbe {
  outcome: ProbeOutcome;
  /** 只有 outcome !== 'inconclusive' 才有意義 */
  supported?: boolean;
  format?: ProbeFormat;
  error?: string;
}

/**
 * M1 capability probe：GET /api/v4/storage_objects?dataset=...&date=...
 * 只判定能力，不解析 parquet、不 ingest、不記錄 signed URL。
 */
export async function probeStorageObjectsCapability(probeDate: string): Promise<StorageProbe> {
  const url = `${FINMIND_STORAGE_OBJECTS_URL}?dataset=TaiwanStockTradingDailyReport&date=${probeDate}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${FINMIND_TOKEN}`,
        // 可送，但不假設上游遵守；一律以 64KiB bounded reader 自保。
        Range: `bytes=0-${MAX_PROBE_BYTES - 1}`,
      },
      signal: AbortSignal.timeout(90_000),
    });
  } catch (e) {
    return { outcome: 'inconclusive', error: sanitizeUpstreamError(`network_or_timeout:${(e as Error)?.message ?? e}`) };
  }

  // 1) HTTP 401 永遠先判 auth_failed（不看 body 字樣）
  if (res.status === 401) {
    try { await res.body?.cancel(); } catch { /* ignore */ }
    return { outcome: 'inconclusive', error: 'auth_failed:http_401' };
  }

  // content-length 過大 → 不讀 body
  const clRaw = res.headers.get('content-length');
  const cl = clRaw ? Number(clRaw) : NaN;
  if (Number.isFinite(cl) && cl > MAX_BULK_BYTES) {
    try { await res.body?.cancel(); } catch { /* ignore */ }
    return { outcome: 'inconclusive', error: `inconclusive_oversize:content_length_${cl}` };
  }

  const bytes = await readBoundedBody(res);
  const text = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.byteLength, MAX_PROBE_BYTES)));

  // 2) 403 或 body 明示 plan 限制
  if (res.status === 403 || (res.status >= 400 && looksPlanRestricted(text))) {
    return { outcome: 'unsupported', supported: false, error: sanitizeUpstreamError(`unsupported_plan:http_${res.status}:${text}`) };
  }
  // 3) 400 參數契約
  if (res.status === 400) {
    return { outcome: 'unsupported', supported: false, error: sanitizeUpstreamError(`unsupported_contract:http_400:${text}`) };
  }
  if (res.status !== 200 && !(res.status === 206)) {
    return { outcome: 'inconclusive', error: sanitizeUpstreamError(`http_${res.status}:${text}`) };
  }
  if (bytes.byteLength === 0) {
    return { outcome: 'inconclusive', error: 'empty_body_0_bytes' };
  }
  // 4) parquet magic
  if (bytes.byteLength >= 4 && bytes[0] === 0x50 && bytes[1] === 0x41 && bytes[2] === 0x52 && bytes[3] === 0x31) {
    return { outcome: 'supported', supported: true, format: 'parquet' };
  }
  // 5) bounded JSON signed URL（URL 不記錄、不跟隨）
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    const hasUrl = ['url', 'signed_url', 'download_url', 'data'].some((k) => typeof j?.[k] === 'string' && /^https?:\/\//.test(String(j[k])));
    if (hasUrl) return { outcome: 'supported', supported: true, format: 'signed_url_unverified' };
    if (looksPlanRestricted(String(j?.msg ?? ''))) {
      return { outcome: 'unsupported', supported: false, error: sanitizeUpstreamError(`unsupported_plan:${String(j?.msg ?? '')}`) };
    }
    return { outcome: 'inconclusive', error: sanitizeUpstreamError(`json_without_url:${text}`) };
  } catch {
    return { outcome: 'inconclusive', error: sanitizeUpstreamError(`bad_magic_or_body:${text.slice(0, 120)}`) };
  }
}

/**
 * M1：capability probe（storage_objects）。tri-state；
 * 只有可判定的 plan/contract 失敗才寫 supported=false；401 與所有 transient 保留前值。
 * Idempotent within a 24h window (probed_at is respected unless force=true).
 */
export async function probeMarketBatchSupport(
  supa: SupabaseClient,
  opts: { force?: boolean; probeDate?: string } = {},
): Promise<ProbeResult> {
  const cfg = await loadMarketBatchConfig(supa);
  if (!opts.force && cfg.probed_at) {
    const age = Date.now() - new Date(cfg.probed_at).getTime();
    if (age < 24 * 3600_000) {
      return {
        supported: cfg.supported === true,
        outcome: cfg.supported === true ? 'supported' : (cfg.supported === false ? 'unsupported' : 'inconclusive'),
        stocks: -1,
        skipped: `probed_${Math.round(age / 3600_000)}h_ago`,
      };
    }
  }
  let calendarFallback = false;
  let probeDate = opts.probeDate ?? null;
  if (!probeDate) {
    probeDate = await resolveLatestTradingDate(supa);
    if (!probeDate) { probeDate = resolveProbeDate(); calendarFallback = true; }
  }
  const nowIso = new Date().toISOString();

  const r = await probeStorageObjectsCapability(probeDate);
  const err = [calendarFallback ? 'calendar_fallback' : null, r.error ?? null].filter(Boolean).join('|') || null;

  if (r.outcome === 'inconclusive') {
    await updateMarketBatchConfig(supa, {
      last_probe_outcome: 'inconclusive',
      last_probe_at: nowIso,
      last_probe_error: err ? err.slice(0, 300) : null,
      last_probe_format: null,
    } as Partial<MarketBatchConfig>);
    return {
      supported: cfg.supported === true,
      outcome: 'inconclusive',
      stocks: 0,
      probe_date: probeDate,
      skipped: `probe_inconclusive:${(err ?? '').slice(0, 200)}`,
      error: err ?? undefined,
    };
  }

  const supported = r.supported === true;
  await updateMarketBatchConfig(supa, {
    supported,
    probed_at: nowIso,
    last_probe_outcome: supported ? 'supported' : 'unsupported',
    last_probe_at: nowIso,
    last_probe_error: err ? err.slice(0, 300) : null,
    last_probe_format: r.format ?? null,
  } as Partial<MarketBatchConfig>);
  return {
    supported,
    outcome: supported ? 'supported' : 'unsupported',
    stocks: 0,
    probe_date: probeDate,
    error: err ?? undefined,
  };
}


/** Group aggregated rows by stock_id (for per-stock rollup rebuild). */
export function groupByStock<T extends { stock_id: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const arr = map.get(r.stock_id);
    if (arr) arr.push(r); else map.set(r.stock_id, [r]);
  }
  return map;
}
