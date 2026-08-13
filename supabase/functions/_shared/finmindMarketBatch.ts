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
const FINMIND_TOKEN = Deno.env.get('FINMIND_TOKEN') ?? '';

export interface MarketBatchConfig {
  enabled: boolean;
  supported: boolean | null;
  probed_at: string | null;
  min_stocks_in_response: number;
  threshold_pending: number;
}

const DEFAULT_CONFIG: MarketBatchConfig = {
  enabled: true,
  supported: null,
  probed_at: null,
  min_stocks_in_response: 500,
  threshold_pending: 15,
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
function isCapabilityFailure(msg: string): boolean {
  const m = msg.toLowerCase();
  if (!m.startsWith('finmind_api_')) return false;
  return /permission|level|upgrade|not allowed|unauthor|forbidden|subscription/.test(m);
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

/**
 * One-shot probe: hit FinMind once without data_id, decide whether the plan
 * supports market batch. Tri-state：只有可判定的 capability 失敗才寫 supported=false；
 * transient（額度、逾時、5xx、壞 JSON、假日 0 rows）維持前值，不動 probed_at。
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
  const probeDate = opts.probeDate ?? resolveProbeDate();
  const nowIso = new Date().toISOString();

  const markInconclusive = async (reason: string): Promise<ProbeResult> => {
    // 不動 supported / probed_at，只記錄診斷資訊。
    await updateMarketBatchConfig(supa, {
      last_probe_outcome: 'inconclusive',
      last_probe_at: nowIso,
      last_probe_error: reason.slice(0, 300),
    } as Partial<MarketBatchConfig>);
    return {
      supported: cfg.supported === true,
      outcome: 'inconclusive',
      stocks: 0,
      probe_date: probeDate,
      skipped: `probe_inconclusive:${reason.slice(0, 200)}`,
      error: reason.slice(0, 300),
    };
  };

  try {
    const rows = await fetchFinmindMarketDay(supa, probeDate, null, 1);
    if (rows.length === 0) {
      // HTTP 200 但 0 rows：極可能是國定假日／尚未結算，不可判定 capability。
      return await markInconclusive('empty_response_rows_0');
    }
    const uniq = new Set(rows.map((r) => String(r.stock_id)));
    const supported = uniq.size >= cfg.min_stocks_in_response;
    await updateMarketBatchConfig(supa, {
      supported,
      probed_at: nowIso,
      last_probe_outcome: supported ? 'supported' : 'unsupported',
      last_probe_at: nowIso,
      last_probe_error: null,
    } as Partial<MarketBatchConfig>);
    return {
      supported,
      outcome: supported ? 'supported' : 'unsupported',
      stocks: uniq.size,
      probe_date: probeDate,
      sample: Array.from(uniq).slice(0, 5),
    };
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    if (e instanceof RateLimitExhaustedError) return await markInconclusive(`rate_limit_exhausted:${msg}`);
    if (isCapabilityFailure(msg)) {
      await updateMarketBatchConfig(supa, {
        supported: false,
        probed_at: nowIso,
        last_probe_outcome: 'unsupported',
        last_probe_at: nowIso,
        last_probe_error: msg.slice(0, 300),
      } as Partial<MarketBatchConfig>);
      return {
        supported: false,
        outcome: 'unsupported',
        stocks: 0,
        probe_date: probeDate,
        error: msg.slice(0, 300),
      };
    }
    // network / abort / 5xx / 429 / bad json / 其他 finmind_api_* → transient
    return await markInconclusive(msg);
  }
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
