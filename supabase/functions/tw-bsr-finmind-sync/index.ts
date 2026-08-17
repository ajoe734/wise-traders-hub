// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// tw-bsr-finmind-sync
// 分層佇列 + 全域限流 + 自動降級狀態機的 FinMind BSR 抓取器。
//
// 模式 (POST body.mode)：
//   - "worker"   從 tw_bsr_sync_queue 取工作處理，依 degrade policy 決定 max_priority / concurrency。
//   - "enqueue"  依規則產生 pending 工作；若 degrade policy 禁止 tier3，會直接跳過。
//   - "manual"   直接指定 stock_ids 抓（管理員用；仍走 queue）。
//   - "stats"    回傳監控快照（用量、queue 深度、成功率、degrade 狀態、最近轉移事件）。
//   - "trace"    傳 correlation_id 查完整事件鏈（queue/reservation/failure/attempt/degrade）。
//
// 每次 worker 呼叫都會：先讀 degrade state、cap 掉超出 policy 的 batch/priority/concurrency、
// 處理完後蒐集訊號 → decide() → 若需轉移就寫入 tw_bsr_degrade_events 並更新 config。

import { corsHeaders } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/supabaseClients.ts';
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import {
  checkRateLimit,
  fetchWithRateLimit,
  RateLimitExhaustedError,
  FINMIND_HOURLY_LIMIT,
} from '../_shared/finmindRateLimit.ts';
import {
  decide,
  effectiveMaxPriority,
  policyOf,
  type DegradeMode,
  type Signals,
} from '../_shared/bsrDegrade.ts';
import {
  addDays,
  aggregate as libAggregate,
  decideQuotaDeferral,
  DONE_BROKER_THRESHOLD,
  isAfterCloseAt,
  isQuotaRejection,
  isWeekday,
  rollBackToWeekday,
  partitionTokenFirst,
  taipeiNowFrom,
  toIsoDate,
  type FinmindRow,
} from './lib.ts';
import {
  fetchFinmindMarketDay,
  loadMarketBatchConfig,
  probeMarketBatchSupport,
  updateMarketBatchConfig,
} from '../_shared/finmindMarketBatch.ts';
import { checkCircuit, recordCircuit } from '../_shared/circuitBreaker.ts';
import { admitFinmind, type FinmindPool } from '../_shared/finmindAdmission.ts';

function poolFromTier(tier: 1 | 2 | 3): FinmindPool {
  if (tier === 1) return 'interactive';
  if (tier === 2) return 'keepwarm';
  return 'backfill';
}

import {
  fulfillDay,
  fulfillJobsFromSnapshot,
  persistAggregated,
} from '../_shared/snapshotFulfillment.ts';
import {
  blockAndTerminalize,
  classifyChunkOutcome,
  classifyProviderError,
  fetchAdmissionStatus,
  sanitizeText,
  summarizeChunks,
  unknownRetryAllowed,
  type AdmissionDecision,
  type AdmissionStatus,
  type ChunkOutcome,
  type ClaimTuple,
  type GateRpcClient,
} from '../_shared/bsrAdmissionGate.ts';
import { resolveProbeUrl } from '../_shared/bsrAdmissionProbe.ts';

// production 一律 official URL。只有 rehearsal（BSR_PROBE_ALLOW_LOCAL=1 且目標為 loopback）
// 才允許注入 provider mock；非 loopback 的注入一律忽略，避免 SSRF / 資料外流。
const FINMIND_URL = resolveProbeUrl(
  Deno.env.get('BSR_PROBE_ALLOW_LOCAL') === '1'
    ? (Deno.env.get('FINMIND_PROBE_BASE_URL') ?? undefined)
    : undefined,
  Deno.env.get('BSR_PROBE_ALLOW_LOCAL') === '1',
).url;
const FINMIND_TOKEN = Deno.env.get('FINMIND_TOKEN') ?? '';

const supa = serviceClient();

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// ============ 交易日 / 時間工具 ============
function taipeiNow(): Date { return taipeiNowFrom(Date.now()); }
function taipeiToday(): string { return toIsoDate(taipeiNow()); }
function isAfterClose(): boolean { return isAfterCloseAt(Date.now()); }

// ============ Degrade state：DB roundtrip ============
async function loadDegradeState(): Promise<{ mode: DegradeMode; since: number; cooldownUntil: number }> {
  const { data } = await supa.rpc('bsr_get_degrade_state', { _api: 'finmind' });
  const row = Array.isArray(data) ? data[0] : data;
  const mode = (row?.mode ?? 'normal') as DegradeMode;
  return {
    mode,
    since: row?.since ? new Date(row.since).getTime() : Date.now(),
    cooldownUntil: row?.cooldown_until ? new Date(row.cooldown_until).getTime() : Date.now(),
  };
}

async function applyDegradeTransition(
  toMode: DegradeMode,
  reason: string,
  metric: string | undefined,
  value: number | undefined,
  threshold: number | undefined,
  cooldownSeconds: number,
  correlationId: string | null,
) {
  const { data, error } = await supa.rpc('bsr_apply_degrade_transition', {
    _api: 'finmind',
    _to_mode: toMode,
    _reason: reason,
    _trigger_metric: metric ?? null,
    _trigger_value: value ?? null,
    _threshold: threshold ?? null,
    _cooldown_seconds: cooldownSeconds,
    _correlation_id: correlationId,
  });
  if (error) console.warn('[degrade] apply failed:', error.message);
  return Array.isArray(data) ? data[0] : data;
}

// ============ FinMind fetch（走限流器；帶 cid + tier）============
function tierFromPriority(priority: number): 1 | 2 | 3 {
  if (priority <= 1) return 1;
  if (priority === 2) return 2;
  return 3;
}

async function fetchFinmindOneDay(
  stockId: string, date: string, cid: string | null, tier: 1 | 2 | 3 = 3,
): Promise<FinmindRow[]> {
  // PR-8 admission gate：kill-switch + circuit + quota pool 三合一。
  // admitFinmind 內部已檢查 circuit，所以不再重複呼叫 checkCircuit。
  const pool = poolFromTier(tier);
  const admit = await admitFinmind(supa, {
    pool,
    kind: `bsr_sync_tier${tier}`,
    stockId,
    circuitSource: 'finmind_bsr',
  });
  if (!admit.granted) {
    throw new Error(`finmind_admission_${admit.reason}:pool=${pool}`);
  }
  const p = new URLSearchParams({
    dataset: 'TaiwanStockTradingDailyReport',
    data_id: stockId,
    start_date: date,
  });
  if (FINMIND_TOKEN) p.set('token', FINMIND_TOKEN);
  const t0 = Date.now();
  try {
    const res = await fetchWithRateLimit(supa, `${FINMIND_URL}?${p}`, {
      signal: AbortSignal.timeout(20_000),
    }, { correlationId: cid, tier });
    // Phase-2: 上游配額 header 觀察
    try {
      const { recordUpstreamQuota } = await import('../_shared/finmindUpstreamQuota.ts');
      await recordUpstreamQuota(supa, 'finmind_bsr', res);
    } catch { /* non-fatal */ }
    const text = await res.text();
    if (!res.ok) {
      await recordCircuit(supa, 'finmind_bsr', false, Date.now() - t0, `http_${res.status}`);
      throw new Error(`finmind_http_${res.status}:${text.slice(0, 200)}`);
    }
    let j: any;
    try { j = JSON.parse(text); } catch {
      await recordCircuit(supa, 'finmind_bsr', false, Date.now() - t0, 'bad_json');
      throw new Error(`finmind_bad_json:${text.slice(0, 200)}`);
    }
    if (j?.status !== 200 && !Array.isArray(j?.data)) {
      await recordCircuit(supa, 'finmind_bsr', false, Date.now() - t0, `api_${j?.status ?? 'unknown'}`);
      throw new Error(`finmind_api_${j?.status ?? 'unknown'}:${String(j?.msg ?? '').slice(0, 200)}`);
    }
    await recordCircuit(supa, 'finmind_bsr', true, Date.now() - t0);
    return Array.isArray(j.data) ? j.data : [];
  } catch (e) {
    // 網路層例外（timeout/abort）也計入失敗
    const msg = (e as Error).message || '';
    if (!msg.startsWith('finmind_http_') && !msg.startsWith('finmind_bad_json') && !msg.startsWith('finmind_api_') && !msg.startsWith('finmind_circuit_open') && !msg.startsWith('finmind_admission_')) {
      await recordCircuit(supa, 'finmind_bsr', false, Date.now() - t0, 'network');
    }
    throw e;
  }
}

const aggregate = libAggregate;

/**
 * Rollup 重算一律走 SQL RPC：DB 端聚合，沒有 PostgREST 1000 列上限問題。
 * （舊版在 TS 端讀 90 天 raw 現算，熱門股一天 800 分點會被截成 1.2 天，
 *   導致 1/5/10/20/60 全部退化成同一天的數字。）
 */
async function rebuildRollup(stockId: string, asOf: string) {
  const { error } = await supa.rpc('rebuild_bsr_rollup', {
    _as_of: asOf,
    _stock_ids: [stockId],
    _max_stocks: 1,
  });
  if (error) throw new Error(`chips_rollup_upsert_failed:${error.message}`);
}


async function isDoneAlready(stockId: string, date: string): Promise<boolean> {
  // M4: 門檻由 5 降至 1；只要有任何一筆分點就視為 done，避免同一日期反覆重跑。
  const { count } = await supa.from('tw_bsr_daily')
    .select('id', { count: 'exact', head: true })
    .eq('stock_id', stockId).eq('trade_date', date);
  return (count ?? 0) >= DONE_BROKER_THRESHOLD;
}

async function recordFailure(stockId: string, date: string, err: string, cid: string | null) {
  try {
    await supa.from('tw_bsr_fetch_failures').upsert({
      stock_id: stockId, trade_date: date,
      reason: 'finmind_error',
      last_error: err.slice(0, 500),
      correlation_id: cid,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'stock_id,trade_date' });
  } catch (e) {
    console.warn('[failure log]', (e as Error).message);
  }
}

async function processStock(
  stockId: string, date: string, cid: string | null, tier: 1 | 2 | 3 = 3,
): Promise<{
  ok: boolean; rows: number; note?: string; error?: string; rateLimited?: boolean;
}> {
  if (await isDoneAlready(stockId, date)) return { ok: true, rows: 0, note: 'already_done' };
  try {
    const rows = await fetchFinmindOneDay(stockId, date, cid, tier);
    if (rows.length === 0) return { ok: true, rows: 0, note: 'finmind_empty' };
    const agg = aggregate(rows);
    if (agg.length === 0) return { ok: true, rows: 0, note: 'aggregated_empty' };
    // P4: 寫入 tw_chip_fact（append-only）+ 觸發 materializer；不再直接寫 tw_bsr_daily。
    const laneSource = tier === 1 ? 'finmind_batch' : 'finmind_per_stock';
    await persistAggregated(supa, date, agg, laneSource);
    // M4: 有任何一筆分點就標記完成；<5 由 tw-chips-detail / UI 加「低品質」標記。
    const isLowQuality = agg.length < 5;
    await supa.from('tw_bsr_fetch_failures')
      .update({ resolved_at: new Date().toISOString(), last_error_message: null })
      .eq('stock_id', stockId).eq('trade_date', date).is('resolved_at', null);
    return { ok: true, rows: agg.length, note: isLowQuality ? 'low_quality' : undefined };
  } catch (e) {
    if (e instanceof RateLimitExhaustedError) {
      return { ok: false, rows: 0, error: e.message, rateLimited: true };
    }
    const msg = e instanceof Error ? e.message : String(e);
    await recordFailure(stockId, date, msg, cid);
    return { ok: false, rows: 0, error: msg };
  }
}

// ============ ENQUEUE ============
// 台股上市櫃普通股 / ETF 白名單：
//   - 4 碼普通股：^\d{4}$（例 2330、2454）
//   - ETF：^00\d{2,4}[A-Z]?$（例 0050、00631L、00878、006203）
// 明確排除 5–6 碼權證 / 受益憑證 / 可轉債 / DR（例 071111、068003、069559、707414）——
// FinMind 的 TaiwanStockInstitutionalInvestorsBuySell 不供應這類代號資料。
const TW_STOCK_ID_WHITELIST = /^(?:\d{4}|00\d{2,4}[A-Z]?)$/;

export function isValidTwStockId(id: string): boolean {
  return TW_STOCK_ID_WHITELIST.test(id);
}

// 分點（BSR / TaiwanStockTradingDailyReport）資料可用性判定。
// FinMind 分點僅覆蓋一般個股；ETF / 權證 / 受益憑證 / 可轉債 / DR 皆無 → 不入 sync 佇列。
// Chip-eligible = 4 碼、首位 1-9 之個股（1101、2330、6285、9958…）。
const TW_CHIP_ELIGIBLE = /^[1-9]\d{3}$/;
export function isChipEligible(id: string): boolean {
  return TW_CHIP_ELIGIBLE.test(id);
}

async function enqueueTier1Holdings(date: string, cid: string, ctx?: EnqueueCtx): Promise<number> {
  // trade_records 的持倉來自 instrument 欄位（格式如「2330 台積電」或「00631L 元大台灣50正2」），
  // 開倉條件為 exit_date IS NULL。ETF/權證/受益憑證雖是合法持倉但 FinMind 無分點，直接濾掉不入隊。
  const { data: openTrades } = await supa
    .from('trade_records')
    .select('instrument, market')
    .is('exit_date', null)
    .limit(5000);
  const ids = Array.from(new Set((openTrades || [])
    .filter((r: any) => {
      const m = String(r.market || '').toUpperCase();
      return m === 'TW' || m === 'TWSE' || m === 'TPEX' || m === '';
    })
    .map((r: any) => {
      const raw = String(r.instrument || '').trim();
      const match = raw.match(/^([1-9][0-9]{3})(?:\s|$)/);
      return match ? match[1] : '';
    })
    .filter(isChipEligible)));
  if (ids.length === 0) return 0;

  // 首抓 vs 補資料分流：
  //   - 從未有 tw_bsr_daily 資料 → post_close_only=false（可在盤中立刻抓）
  //   - 已有歷史資料 → post_close_only=true（僅收盤後 14:00 起同步）
  const { data: haveAny } = await supa.from('tw_bsr_daily')
    .select('stock_id').in('stock_id', ids);
  const seen = new Set((haveAny || []).map((r: any) => String(r.stock_id)));
  const firstFetch = ids.filter((id) => !seen.has(id));
  const postClose = ids.filter((id) => seen.has(id));
  let total = 0;
  if (firstFetch.length > 0) total += await enqueueBatch(firstFetch, date, 1, 'tier1_first_fetch', cid, false, ctx);
  if (postClose.length > 0) total += await enqueueBatch(postClose, date, 1, 'tier1_holdings', cid, true, ctx);
  return total;
}


async function enqueueTier2Gaps(date: string, cid: string, ctx?: EnqueueCtx): Promise<number> {
  const dates = [date, rollBackToWeekday(addDays(date, -1)), rollBackToWeekday(addDays(date, -2))];
  const gapIds = new Set<string>();
  for (const d of dates) {
    const { data: inst } = await supa.from('tw_institutional_daily')
      .select('stock_id').eq('trade_date', d).limit(1500);
    const instIds = (inst || []).map((r: any) => String(r.stock_id));
    if (instIds.length === 0) continue;
    const { data: done } = await supa.from('tw_bsr_daily')
      .select('stock_id').eq('trade_date', d).in('stock_id', instIds);
    const doneSet = new Set((done || []).map((r: any) => r.stock_id));
    for (const id of instIds) if (!doneSet.has(id) && isChipEligible(id)) gapIds.add(id);
  }
  const { data: failed } = await supa.from('tw_bsr_fetch_failures')
    .select('stock_id').is('resolved_at', null)
    .gte('trade_date', addDays(date, -7)).limit(500);
  for (const r of failed || []) {
    const sid = String(r.stock_id);
    if (isChipEligible(sid)) gapIds.add(sid);
  }
  if (gapIds.size === 0) return 0;
  return await enqueueBatch(Array.from(gapIds), date, 2, 'tier2_gaps', cid, true, ctx);
}

async function enqueueTier3Backfill(endDate: string, days: number, cid: string, ctx?: EnqueueCtx): Promise<number> {
  // 與 Tier 1 一致：從 trade_records.instrument（開倉：exit_date IS NULL）抽 4–6 碼代號，並套白名單。
  const { data: openTrades } = await supa
    .from('trade_records')
    .select('instrument, market')
    .is('exit_date', null)
    .limit(5000);
  const ids = Array.from(new Set((openTrades || [])
    .filter((r: any) => {
      const m = String(r.market || '').toUpperCase();
      return m === 'TW' || m === 'TWSE' || m === 'TPEX' || m === '';
    })
    .map((r: any) => {
      const raw = String(r.instrument || '').trim();
      const match = raw.match(/^([1-9][0-9]{3})(?:\s|$)/);
      return match ? match[1] : '';
    })
    .filter(isChipEligible)));
  let total = 0;
  for (let i = 1; i <= days; i++) {
    const d = rollBackToWeekday(addDays(endDate, -i));
    total += await enqueueBatch(ids, d, 3, 'tier3_backfill', cid, true, ctx);
  }
  return total;
}


/**
 * Stage B：enqueue writer 的 admission 會計。
 * 每個 chunk 沿用既有 `insert(..., { count: 'exact' })`；只有在 gate status **明確 blocked**
 * 且 insert error=null 時，才把 `candidate - inserted` 記成 blocked。duplicate / error /
 * status unknown 一律 unknown/error，絕不用全表 delta 反推。
 */
interface EnqueueCtx {
  admission: AdmissionStatus;
  /** 本次請求所有 chunk 的 admission 會計（HTTP body / edge log 用） */
  chunks: ChunkOutcome[];
}

async function enqueueBatch(
  stockIds: string[],
  date: string,
  priority: number,
  tag: string,
  correlationId: string,
  postCloseOnly = false,
  ctx?: EnqueueCtx,
): Promise<number> {
  const detail = await enqueueBatchDetailed(
    stockIds, date, priority, tag, correlationId, postCloseOnly, ctx?.admission,
  );
  if (ctx) ctx.chunks.push(...detail.chunks);
  return detail.inserted;
}

interface EnqueueDetail {
  inserted: number;
  chunks: ChunkOutcome[];
  admission_decision: AdmissionDecision;
  admission_version: number | null;
  admission_reason: string | null;
  summary: ReturnType<typeof summarizeChunks>;
}

async function enqueueBatchDetailed(
  stockIds: string[],
  date: string,
  priority: number,
  tag: string,
  correlationId: string,
  postCloseOnly = false,
  admissionIn?: AdmissionStatus,
): Promise<EnqueueDetail> {
  const admission = admissionIn ?? await fetchAdmissionStatus(supa as unknown as GateRpcClient);
  const empty = (chunks: ChunkOutcome[] = []): EnqueueDetail => ({
    inserted: 0,
    chunks,
    admission_decision: admission.decision,
    admission_version: admission.version,
    admission_reason: admission.reason ?? admission.detail,
    summary: summarizeChunks(chunks),
  });

  if (stockIds.length === 0 || !isWeekday(date)) return empty();
  const { data: done } = await supa.from('tw_bsr_daily')
    .select('stock_id').eq('trade_date', date).in('stock_id', stockIds);
  const doneSet = new Set((done || []).map((r: any) => r.stock_id));
  const targets = stockIds.filter((id) => !doneSet.has(id));
  if (targets.length === 0) return empty();
  // 每個 job 有自己的 cid：便於單一同步事件的追蹤（enqueue 帶入的 cid 只是 batch 標記，僅保留在 tag/log）
  const rows = targets.map((id) => ({
    stock_id: id, trade_date: date, priority, status: 'pending',
    next_run_at: new Date().toISOString(),
    enqueued_by: `${tag}:${correlationId.slice(0, 8)}`,
    correlation_id: crypto.randomUUID(),
    post_close_only: postCloseOnly,
  }));

  const { data: existing } = await supa.from('tw_bsr_sync_queue')
    .select('stock_id, trade_date')
    .in('stock_id', targets).eq('trade_date', date)
    .in('status', ['pending', 'running']);
  const existSet = new Set((existing || []).map((r: any) => `${r.stock_id}|${r.trade_date}`));
  const toInsert = rows.filter((r) => !existSet.has(`${r.stock_id}|${r.trade_date}`));
  if (toInsert.length === 0) return empty();
  const CHUNK = 500;
  let inserted = 0;
  const chunks: ChunkOutcome[] = [];
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const slice = toInsert.slice(i, i + CHUNK);
    const { error, count } = await supa.from('tw_bsr_sync_queue')
      .insert(slice, { count: 'exact' });
    const outcome = classifyChunkOutcome({
      admission,
      candidateCount: slice.length,
      insertedCount: error ? 0 : (count ?? null),
      error: error ? { message: error.message } : null,
    });
    chunks.push(outcome);
    if (error) console.warn(`enqueue insert error: ${sanitizeText(error.message, 200)}`);
    else inserted += count ?? 0;
  }
  return {
    inserted,
    chunks,
    admission_decision: admission.decision,
    admission_version: admission.version,
    admission_reason: admission.reason ?? admission.detail,
    summary: summarizeChunks(chunks),
  };
}

// ============ Signal collection for state machine ============
async function collectSignals(rl: { used: number; limit: number }): Promise<Signals> {
  const usagePct = rl.limit > 0 ? (rl.used / rl.limit) * 100 : 0;
  const { data: rs } = await supa.rpc('bsr_reservation_stats', { _api: 'finmind' });
  const rsRow = Array.isArray(rs) ? rs[0] : rs;
  // Build 1b: only P1 jobs that are actually claimable (due now) can stall the system.
  // Quota-deferred P1 rows have next_run_at in the future and must NOT trigger p1_stalled.
  const { data: oldestP1 } = await supa.from('tw_bsr_sync_queue')
    .select('next_run_at').eq('priority', 1).eq('status', 'pending')
    .not('next_run_at', 'is', null).lte('next_run_at', new Date().toISOString())
    .order('next_run_at', { ascending: true }).limit(1);
  const p1Age = oldestP1?.[0]
    ? Math.round((Date.now() - new Date(oldestP1[0].next_run_at).getTime()) / 1000)
    : 0;
  const since = new Date(Date.now() - 60 * 60_000).toISOString();
  const { data: usage } = await supa.from('tw_bsr_api_usage')
    .select('bucket_start,rate_limited_count')
    .eq('api_name', 'finmind').gte('bucket_start', since)
    .order('bucket_start', { ascending: true });
  let streak = 0, maxStreak = 0;
  for (const r of (usage ?? []) as Array<{ rate_limited_count: number }>) {
    if ((r.rate_limited_count ?? 0) > 0) { streak++; maxStreak = Math.max(maxStreak, streak); }
    else streak = 0;
  }
  return {
    usagePct,
    rateLimited429Streak: maxStreak,
    p1OldestPendingAgeSec: p1Age,
    reservationExpiredUnsettled: Number(rsRow?.expired_unsettled ?? 0),
    reservationOldestInFlightSec: Number(rsRow?.oldest_in_flight_age_seconds ?? 0),
  };
}

async function evaluateAndMaybeTransition(cid: string | null): Promise<{ mode: DegradeMode; transitioned: any }> {
  const rl = await checkRateLimit(supa);
  const sig = await collectSignals(rl);
  const state = await loadDegradeState();
  const d = decide(state, sig, Date.now());
  let transitioned: any = null;
  if (d.shouldTransition && d.targetMode !== state.mode) {
    transitioned = await applyDegradeTransition(
      d.targetMode, d.reason, d.triggerMetric, d.triggerValue, d.threshold,
      d.cooldownSeconds, cid,
    );
  }
  return { mode: transitioned?.applied ? d.targetMode : state.mode, transitioned };
}

// ============ WORKER ============
async function runWorker(batch: number, maxPriority: number, budgetMs: number): Promise<any> {
  const started = Date.now();
  const results: any[] = [];
  let processed = 0, ok = 0, rateLimitedStop = false;
  const runId = crypto.randomUUID();

  // ============ Stage B：admission gate（fail-closed，必須在任何 claim / provider 呼叫之前）
  // blocked / gate row 不存在 / 形狀不對 / RPC error 一律不 claim、不打 provider。
  const admission = await fetchAdmissionStatus(supa as unknown as GateRpcClient);
  if (!admission.allowed) {
    return {
      ok: true,
      note: 'admission_gate_closed',
      admission: {
        decision: admission.decision,
        blocked: admission.blocked,
        reason: admission.reason ?? admission.detail,
        terminal_code: admission.terminalCode,
        blocked_at: admission.blockedAt,
        gate_version: admission.version,
      },
      claimed: 0,
      processed: 0,
      provider_calls: 0,
      run_id: runId,
      elapsed_ms: Date.now() - started,
    };
  }


  // 0) 每次 worker 呼叫先 purge 一次過期 lease，避免上一輪 crash 的 reservation 佔用額度
  const { data: purgeRow } = await supa.rpc('purge_expired_bsr_reservations', { _api: 'finmind' });
  const purgeSummary = Array.isArray(purgeRow) ? purgeRow[0] : purgeRow;
  const recycledCount = Number(purgeSummary?.recycled_count ?? 0);
  const recycledIds = (purgeSummary?.recycled_ids ?? []) as number[];
  if (recycledCount > 0) {
    console.warn(`[worker] recycled ${recycledCount} expired reservation(s): ${recycledIds.slice(0, 10).join(',')}`);
  }

  // 1) 讀取當前 degrade 狀態，套用 policy
  const state = await loadDegradeState();
  const policy = policyOf(state.mode);
  const cappedMaxPriority = effectiveMaxPriority(state.mode, maxPriority);
  const cappedConcurrency = Math.min(policy.concurrency, 3);

  // claim_halt：只回收 lease、不 claim job
  if (!policy.allowClaim) {
    const after = await evaluateAndMaybeTransition(null);
    return {
      ok: true, note: 'claim_halt', degrade_mode: state.mode,
      transitioned: after.transitioned, processed: 0,
      recycled_reservations: recycledCount,
    };
  }

  const rl = await checkRateLimit(supa);
  if (!rl.allowed) {
    const after = await evaluateAndMaybeTransition(null);
    return { ok: true, note: 'rate_limit_exhausted', rate_limit: rl,
      degrade_mode: state.mode, transitioned: after.transitioned, processed: 0 };
  }
  const effectiveBatch = Math.min(batch, Math.max(1, rl.remaining));

  // ============ M3 v2 Phase A：Snapshot-first coalesced fetch ============
  // 在 claim per-stock job 之前，先看看有沒有整日可以「一次抓完」。若 market batch
  // supported 且該 date 的 pending 量 ≥ threshold，一次呼叫解決該日全部 job。
  const snapshotResults: any[] = [];
  const mbCfg = await loadMarketBatchConfig(supa);
  const canMarketBatch = mbCfg.enabled && mbCfg.supported === true;
  if (canMarketBatch && cappedMaxPriority >= 1) {
    const { data: dateBuckets } = await supa
      .from('tw_bsr_sync_queue')
      .select('trade_date, priority')
      .eq('status', 'pending')
      .lte('priority', cappedMaxPriority)
      .lte('next_run_at', new Date().toISOString())
      .limit(2000);
    const counts = new Map<string, { total: number; minP: number }>();
    for (const r of (dateBuckets ?? []) as Array<{ trade_date: string; priority: number }>) {
      const cur = counts.get(r.trade_date) ?? { total: 0, minP: 3 };
      cur.total += 1;
      cur.minP = Math.min(cur.minP, r.priority);
      counts.set(r.trade_date, cur);
    }
    const candidates = Array.from(counts.entries())
      .filter(([, v]) => v.total >= mbCfg.threshold_pending)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 3);
    for (const [date, meta] of candidates) {
      if (Date.now() - started > budgetMs * 0.6) break;
      const cid = crypto.randomUUID();
      try {
        const rows = await fetchFinmindMarketDay(supa, date, cid, tierFromPriority(meta.minP));
        const outcome = await fulfillDay(supa, date, cid, rows, 'finmind_market_batch');
        snapshotResults.push({ date, priority_min: meta.minP, ...outcome });
      } catch (e) {
        const msg = (e as Error).message ?? String(e);
        snapshotResults.push({ date, error: msg.slice(0, 200) });
        if (e instanceof RateLimitExhaustedError) { rateLimitedStop = true; break; }
      }
    }
  }

  // ============ Phase B：per-stock 補刀（fallback） ============
  // 若 market batch 已消化完該 date 的 pending job，此處會直接 no_jobs。
  const { data: claimedJobs, error } = await supa.rpc('claim_bsr_queue_jobs', {
    _batch: effectiveBatch, _max_priority: cappedMaxPriority,
  });
  if (error) return { ok: false, error: `claim_failed:${error.message}` };
  if (!claimedJobs || claimedJobs.length === 0) {
    const after = await evaluateAndMaybeTransition(null);
    return {
      ok: true, note: snapshotResults.length > 0 ? 'snapshot_only' : 'no_jobs',
      rate_limit: rl, degrade_mode: state.mode, transitioned: after.transitioned,
      processed: 0, snapshot_fulfilled: snapshotResults,
      recycled_reservations: recycledCount,
    };
  }

  // Build 1f：token 優先的 stable partition（DB 已排序，這裡是 driver 順序的防禦性保險）。
  const jobs = partitionTokenFirst(claimedJobs as Array<{ last_error?: string | null }>) as typeof claimedJobs;

  // ============ Stage B：保留 claim 當下的 exact (id, started_at, attempts)
  // terminalize 只能作用在本 run 真正持有 lease 的列；任何被 reaper 回收或被別人重 claim
  // 的列，pairwise 條件會自然不成立 → 計入 lost_lease_count。
  const outstandingClaims = new Map<number, ClaimTuple>();
  for (const j of jobs as Array<Record<string, unknown>>) {
    outstandingClaims.set(Number(j.id), {
      id: Number(j.id),
      started_at: (j.started_at as string | null) ?? null,
      attempts: j.attempts === null || j.attempts === undefined ? null : Number(j.attempts),
    });
  }
  /** 任一 job 已由本 run 自行改寫狀態 → 不再持有 lease，不可再被 terminalize。 */
  const releaseClaim = (id: unknown) => { outstandingClaims.delete(Number(id)); };

  let terminalStop = false;
  let terminalReport: Record<string, unknown> | null = null;


  // Build 1 可觀測性：per-job 明細，讓 HTTP body 能逐筆對回 tw_bsr_sync_queue。
  const jobOutcomes: Array<{
    id: number; stock_id: string; trade_date: string; priority: number;
    outcome: string; rows_written: number; last_error: string | null;
  }> = [];
  function recordOutcome(job: any, outcome: string, rowsWritten: number, lastError: string | null) {
    jobOutcomes.push({
      id: job.id, stock_id: job.stock_id, trade_date: job.trade_date,
      priority: job.priority, outcome, rows_written: rowsWritten,
      last_error: lastError ? lastError.slice(0, 200) : null,
    });
  }

  let idx = 0;
  async function worker() {
    while (idx < jobs.length) {
      if (Date.now() - started > budgetMs) return;
      if (rateLimitedStop) return;
      if (terminalStop) return;

      const my = idx++;
      const job = jobs[my];
      const cid: string | null = job.correlation_id ?? null;
      const t0 = Date.now();
      const r = await processStock(job.stock_id, job.trade_date, cid, tierFromPriority(job.priority));
      processed++;
      if (r.ok) ok++;
      results.push({
        id: job.id, cid, stock_id: job.stock_id, date: job.trade_date,
        priority: job.priority, ms: Date.now() - t0, ...r,
      });
      if (r.ok) {
        // finmind_empty / aggregated_empty / aggregated_partial：都不是完整完成。
        // 只能重試或在達上限後 skipped，絕不可標 done，避免所有股票卡在「假完成」。
        const isIncomplete = r.note === 'finmind_empty' || r.note === 'aggregated_empty' || r.note === 'aggregated_partial';
        const nextAttempts = (job.attempts ?? 1);

        // 上游窮竭探測：對「非今日 & 空回應」記錄一次 probe；
        // mark_bsr_upstream_probe 內部會累積 empty_streak 並於 20 連空時標 exhausted。
        try {
          const today = new Date().toISOString().slice(0, 10);
          const isEmpty = r.note === 'finmind_empty' || r.note === 'aggregated_empty' || (r.rows ?? 0) === 0;
          if (job.trade_date && job.trade_date < today) {
            await supa.rpc('mark_bsr_upstream_probe', {
              p_stock_id: job.stock_id,
              p_probed_date: job.trade_date,
              p_had_data: !isEmpty && (r.rows ?? 0) > 0,
            });
          }
        } catch (probeErr) {
          console.warn(`[${cid}] mark_bsr_upstream_probe failed:`, (probeErr as Error).message);
        }

        if (isIncomplete && nextAttempts >= (job.max_attempts ?? 5)) {
          const lastError = r.note === 'aggregated_partial' ? 'partial_chip_data' : 'no_chip_data';
          await supa.from('tw_bsr_sync_queue').update({
            status: 'skipped',
            finished_at: new Date().toISOString(),
            last_error: lastError,
            next_run_at: null,
            started_at: null,
          }).eq('id', job.id);
          releaseClaim(job.id);
          recordOutcome(job, 'skipped', 0, lastError);
        } else if (isIncomplete) {
          const backoffMin = !isAfterClose() ? 30 : Math.min(120, Math.pow(2, nextAttempts) * 5);
          await supa.from('tw_bsr_sync_queue').update({
            status: 'pending',
            finished_at: null,
            started_at: null,
            last_error: r.note ?? 'incomplete_chip_data',
            next_run_at: new Date(Date.now() + backoffMin * 60_000).toISOString(),
          }).eq('id', job.id);
          releaseClaim(job.id);
          recordOutcome(job, 'partial', 0, r.note ?? 'incomplete_chip_data');
        } else {
          await supa.from('tw_bsr_sync_queue').update({
            status: 'done',
            finished_at: new Date().toISOString(),
            last_success_at: r.rows > 0 ? new Date().toISOString() : undefined,
            last_error: null,
          }).eq('id', job.id);
          releaseClaim(job.id);
          recordOutcome(job, 'done', r.rows ?? 0, null);
        }
      } else if (isQuotaRejection(r.error)) {
        // Quota 拒絕：不是資料問題，attempts 抵銷回 claim 前的值，避免 5 輪後
        // 變成 failed 而被 partial unique index 永久擋住（飢餓）。
        const deferral = decideQuotaDeferral({
          attempts: job.attempts ?? 1,
          nowMs: Date.now(),
          jitter: Math.random(),
        });
        const { error: deferErr } = await supa.rpc('defer_bsr_job_quota', {
          p_job_id: job.id,
          p_delay_minutes: deferral.delayMinutes,
        });
        if (deferErr) console.warn(`[${cid}] defer_bsr_job_quota failed:`, sanitizeText(deferErr.message, 200));
        releaseClaim(job.id);
        recordOutcome(job, 'quota_deferred', 0, 'quota_deferred');
        if (r.rateLimited) { rateLimitedStop = true; return; }
      } else if (classifyProviderError(r.error ?? null).outcome === 'terminal') {
        // ============ Stage B：exact FinMind 方案／資格拒絕 → 單一原子 RPC
        // 關 gate + 只 terminalize 本 run 仍持有 lease 的列。不做全 pending UPDATE，
        // 不直呼 private schema；RPC 基礎設施失敗會有界重試且不假成功。
        terminalStop = true;
        const claims = Array.from(outstandingClaims.values());
        const res = await blockAndTerminalize(supa as unknown as GateRpcClient, {
          runId,
          claims,
          evidence: {
            admission_probe_schema_version: '1',
            detected_at: new Date().toISOString(),
            provider: 'finmind',
            error_class: 'provider_plan_rejected',
            trigger_stock_id: String(job.stock_id),
            trigger_trade_date: String(job.trade_date),
            claim_count: claims.length,
            signature: sanitizeText(r.error ?? '', 160),
          },
        });
        if (res.ok) {
          for (const c of claims) outstandingClaims.delete(c.id);
        }
        terminalReport = {
          terminal_code: 'finmind_admission_provider_plan_rejected',
          rpc_ok: res.ok,
          transition: res.transition,
          gate_version: res.gateVersion,
          claim_count: res.claimCount,
          updated_count: res.updatedCount,
          lost_lease_count: res.lostLeaseCount,
          rpc_attempts: res.attemptsUsed,
          rpc_error: res.error,
        };
        recordOutcome(job, res.ok ? 'terminal_blocked' : 'terminal_block_failed', 0,
          'finmind_admission_provider_plan_rejected');
        return;
      } else {
        // retryable（429/5xx/timeout/network）與 unknown 都走既有 backoff 語意；
        // unknown 只有有界重試，永遠不會升級成 terminal、也不會關 gate。
        const nextAttempts = (job.attempts ?? 1);
        const backoffMin = Math.min(120, Math.pow(2, nextAttempts) * 5);
        const shouldFail = !unknownRetryAllowed(nextAttempts, job.max_attempts ?? 5);
        await supa.from('tw_bsr_sync_queue').update({
          status: shouldFail ? 'failed' : 'pending',
          finished_at: shouldFail ? new Date().toISOString() : null,
          last_error: r.error?.slice(0, 500) ?? null,
          next_run_at: shouldFail ? undefined : new Date(Date.now() + backoffMin * 60_000).toISOString(),
          started_at: null,
        }).eq('id', job.id);
        releaseClaim(job.id);
        recordOutcome(job, shouldFail ? 'failed' : 'retry_pending', 0, r.error ?? null);
        if (r.rateLimited) { rateLimitedStop = true; return; }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(cappedConcurrency, jobs.length) }, worker));


  const finalRl = await checkRateLimit(supa);
  // 最後一輪：用最新訊號重新評估狀態轉移；用最後一筆 job 的 cid 作為 audit 關聯
  const lastCid = results[results.length - 1]?.cid ?? null;
  const post = await evaluateAndMaybeTransition(lastCid);
  return {
    ok: true, processed, success: ok,
    claimed: jobs.length, batch: effectiveBatch,
    run_id: runId,
    admission: {
      decision: admission.decision, blocked: false, gate_version: admission.version,
    },
    stopped_by_terminal: terminalStop,
    terminal: terminalReport,
    degrade_mode: state.mode, degrade_after: post.mode, transitioned: post.transitioned,
    policy: { max_priority: cappedMaxPriority, concurrency: cappedConcurrency },
    rate_limit_before: rl, rate_limit_after: finalRl,
    stopped_by_rate_limit: rateLimitedStop,
    recycled_reservations: recycledCount,
    snapshot_fulfilled: snapshotResults,
    elapsed_ms: Date.now() - started,
    // Build 1 可觀測性（既有欄位全部保留，以下為新增）
    rows_written: jobOutcomes.reduce((s, j) => s + j.rows_written, 0),
    jobs_succeeded: jobOutcomes.filter((j) => j.outcome === 'done').length,
    jobs_partial: jobOutcomes.filter((j) => j.outcome === 'partial' || j.outcome === 'skipped').length,
    jobs_quota_deferred: jobOutcomes.filter((j) => j.outcome === 'quota_deferred').length,
    jobs_failed: jobOutcomes.filter((j) => j.outcome === 'failed').length,
    job_ids: jobOutcomes.map((j) => j.id),
    jobs: jobOutcomes,
    results,
  };

}

// ============ STATS ============
async function runStats() {
  const rl = await checkRateLimit(supa);
  const { data: usage } = await supa.from('tw_bsr_api_usage')
    .select('bucket_start, call_count, success_count, error_count, rate_limited_count')
    .gte('bucket_start', new Date(Date.now() - 24 * 3600_000).toISOString())
    .order('bucket_start', { ascending: false });
  const hourly: Record<string, any> = {};
  for (const r of usage || []) {
    const hr = String(r.bucket_start).slice(0, 13) + ':00';
    if (!hourly[hr]) hourly[hr] = { calls: 0, success: 0, error: 0, r429: 0 };
    hourly[hr].calls += r.call_count;
    hourly[hr].success += r.success_count;
    hourly[hr].error += r.error_count;
    hourly[hr].r429 += r.rate_limited_count;
  }
  const { data: depth } = await supa.from('tw_bsr_sync_queue')
    .select('priority, status').in('status', ['pending', 'running']).limit(10000);
  const queue: Record<string, Record<string, number>> = {};
  for (const r of depth || []) {
    const k = `p${r.priority}`;
    queue[k] = queue[k] || { pending: 0, running: 0 };
    queue[k][r.status] = (queue[k][r.status] || 0) + 1;
  }
  const total24 = (usage || []).reduce((s, r) => s + r.call_count, 0);
  const err24 = (usage || []).reduce((s, r) => s + r.error_count, 0);
  const r429_24 = (usage || []).reduce((s, r) => s + r.rate_limited_count, 0);
  const { data: latencies } = await supa.from('tw_bsr_sync_queue')
    .select('priority, enqueued_at, finished_at')
    .eq('status', 'done').not('finished_at', 'is', null)
    .gte('finished_at', new Date(Date.now() - 24 * 3600_000).toISOString())
    .limit(2000);
  const latByP: Record<string, number[]> = {};
  for (const r of latencies || []) {
    const p = `p${r.priority}`;
    const ms = new Date(r.finished_at!).getTime() - new Date(r.enqueued_at).getTime();
    (latByP[p] = latByP[p] || []).push(ms);
  }
  const latSummary: Record<string, any> = {};
  for (const [p, arr] of Object.entries(latByP)) {
    arr.sort((a, b) => a - b);
    latSummary[p] = {
      count: arr.length,
      p50_ms: arr[Math.floor(arr.length * 0.5)],
      p95_ms: arr[Math.floor(arr.length * 0.95)],
      max_ms: arr[arr.length - 1],
    };
  }

  const { data: resStats } = await supa.rpc('bsr_reservation_stats', { _api: 'finmind' });
  const resRow = Array.isArray(resStats) ? resStats[0] : resStats;

  // Stuck reservations（in-flight 且 age ≥ 30s）：任何 worker crash/timeout 都會出現在這裡
  const { data: stuck } = await supa.rpc('bsr_list_stuck_reservations', {
    _api: 'finmind', _min_age_seconds: 30, _limit: 20,
  });

  // Build 1b: same due-filter as collectSignals — deferred P1 is debt, not a stall.
  const { data: oldestP1 } = await supa.from('tw_bsr_sync_queue')
    .select('next_run_at')
    .eq('priority', 1).eq('status', 'pending')
    .not('next_run_at', 'is', null).lte('next_run_at', new Date().toISOString())
    .order('next_run_at', { ascending: true }).limit(1);
  const p1OldestAgeSec = oldestP1?.[0]
    ? Math.round((Date.now() - new Date(oldestP1[0].next_run_at).getTime()) / 1000)
    : 0;

  const recent = (usage || [])
    .filter((r) => new Date(r.bucket_start).getTime() >= Date.now() - 60 * 60_000)
    .sort((a, b) => (a.bucket_start < b.bucket_start ? 1 : -1));
  let r429Streak = 0, r429MaxStreak = 0;
  for (const r of recent) {
    if ((r.rate_limited_count || 0) > 0) { r429Streak++; r429MaxStreak = Math.max(r429MaxStreak, r429Streak); }
    else r429Streak = 0;
  }

  // Degrade state + 最近 20 筆轉移事件
  const { data: dgState } = await supa.rpc('bsr_get_degrade_state', { _api: 'finmind' });
  const dgRow = Array.isArray(dgState) ? dgState[0] : dgState;
  const { data: dgRecent } = await supa.rpc('bsr_recent_degrade_events', { _api: 'finmind', _limit: 20 });
  const policy = policyOf((dgRow?.mode ?? 'normal') as DegradeMode);

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    rate_limit: rl,
    limit_config: { hourly_limit: FINMIND_HOURLY_LIMIT },
    queue_depth: queue,
    last_24h: {
      total_calls: total24, errors: err24, r429: r429_24,
      success_rate: total24 > 0 ? +((1 - err24 / total24) * 100).toFixed(2) : null,
    },
    hourly_last_24h: hourly,
    queue_latency_ms: latSummary,
    reservations: {
      in_flight: Number(resRow?.in_flight ?? 0),
      expiring_soon: Number(resRow?.expiring_soon ?? 0),
      expired_unsettled: Number(resRow?.expired_unsettled ?? 0),
      settled_last_hour: Number(resRow?.settled_last_hour ?? 0),
      rate_limited_last_hour: Number(resRow?.rate_limited_last_hour ?? 0),
      oldest_in_flight_age_seconds: Number(resRow?.oldest_in_flight_age_seconds ?? 0),
    },
    stuck_reservations: (stuck ?? []) as Array<{
      id: number; correlation_id: string | null;
      reserved_at: string; expires_at: string; age_seconds: number; expired: boolean;
    }>,
    p1_oldest_pending_age_seconds: p1OldestAgeSec,
    rate_limited_streak_minutes: r429MaxStreak,
    degrade: {
      mode: dgRow?.mode ?? 'normal',
      since: dgRow?.since ?? null,
      reason: dgRow?.reason ?? null,
      trigger_metric: dgRow?.trigger_metric ?? null,
      trigger_value: dgRow?.trigger_value ?? null,
      last_transition_at: dgRow?.last_transition_at ?? null,
      cooldown_until: dgRow?.cooldown_until ?? null,
      policy: {
        max_priority: policy.maxPriority,
        concurrency: policy.concurrency,
        allow_claim: policy.allowClaim,
        allow_enqueue_tier3: policy.allowEnqueueTier3,
      },
      recent_transitions: dgRecent ?? [],
    },
    snapshot: await (async () => {
      try {
        const { data } = await supa.rpc('bsr_snapshot_stats', { _days: 14 });
        const row = Array.isArray(data) ? data[0] : data;
        return row
          ? {
              window_days: 14,
              total_days: Number(row.total_days ?? 0),
              ready_days: Number(row.ready_days ?? 0),
              partial_days: Number(row.partial_days ?? 0),
              exhausted_days: Number(row.exhausted_days ?? 0),
              hit_ratio_24h: row.hit_ratio_24h == null ? null : Number(row.hit_ratio_24h),
              quota_per_day_avg: row.quota_per_day_avg == null ? null : Number(row.quota_per_day_avg),
              oldest_pending_days: Number(row.oldest_pending_days ?? 0),
            }
          : null;
      } catch (e) {
        console.warn('[stats] snapshot_stats failed:', (e as Error).message);
        return null;
      }
    })(),
    tier_admission: await (async () => {
      const tiers: Array<1 | 2 | 3> = [1, 2, 3];
      const out: Record<string, {
        allowed: boolean; reason: string;
        hourly_used: number; tier_used: number;
        tier_guarantee: number; available_for_tier: number;
      }> = {};
      for (const t of tiers) {
        try {
          const { data } = await supa.rpc('bsr_check_tier_admission', {
            _api: 'finmind', _tier: t, _limit: 1500,
          });
          const row = Array.isArray(data) ? data[0] : data;
          if (row) {
            out[`tier${t}`] = {
              allowed: Boolean(row.allowed),
              reason: String(row.reason ?? '—'),
              hourly_used: Number(row.hourly_used ?? 0),
              tier_used: Number(row.tier_used ?? 0),
              tier_guarantee: Number(row.tier_guarantee ?? 0),
              available_for_tier: Number(row.available_for_tier ?? 0),
            };
          }
        } catch (e) {
          console.warn(`[stats] tier${t} admission failed:`, (e as Error).message);
        }
      }
      return out;
    })(),
    market_batch: await (async () => {
      try {
        const cfg = await loadMarketBatchConfig(supa);
        // 最近 24h Phase A 觸發次數：從 tw_bsr_daily_snapshot_status 觀察 source
        const since = new Date(Date.now() - 24 * 3600_000).toISOString();
        const { data: recent } = await supa
          .from('tw_bsr_daily_snapshot_status')
          .select('trade_date, source, status, coverage_stocks, coverage_rows, updated_at')
          .gte('updated_at', since)
          .order('updated_at', { ascending: false })
          .limit(20);
        const batchDays = (recent ?? []).filter((r: any) => r.source === 'finmind_market_batch').length;
        const perStockDays = (recent ?? []).filter((r: any) => r.source === 'finmind_per_stock').length;
        return {
          enabled: cfg.enabled,
          supported: cfg.supported,
          probed_at: cfg.probed_at,
          min_stocks_in_response: cfg.min_stocks_in_response,
          threshold_pending: cfg.threshold_pending,
          effective: cfg.enabled && cfg.supported === true,
          last_24h: {
            batch_days: batchDays,
            per_stock_days: perStockDays,
            recent_snapshots: recent ?? [],
          },
        };
      } catch (e) {
        console.warn('[stats] market_batch failed:', (e as Error).message);
        return null;
      }
    })(),
  };
}


// ============ HTTP entry ============
Deno.serve(async (req) => {
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

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const mode = String(body?.mode || 'worker');

    if (mode === 'stats') return json(await runStats());

    if (mode === 'trace') {
      const cid = String(body?.correlation_id ?? '').trim();
      if (!/^[0-9a-f-]{36}$/i.test(cid)) return json({ ok: false, error: 'correlation_id required (uuid)' }, 400);
      const { data, error } = await supa.rpc('bsr_trace_by_correlation', { _cid: cid });
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, trace: data });
    }

    // Manual purge / force-recycle：管理員從 UI 觸發，也可掛 cron 加強頻率
    if (mode === 'purge_reservations') {
      const { data, error } = await supa.rpc('purge_expired_bsr_reservations', { _api: 'finmind' });
      if (error) return json({ ok: false, error: error.message }, 500);
      const row = Array.isArray(data) ? data[0] : data;
      return json({ ok: true, recycled_count: Number(row?.recycled_count ?? 0), recycled_ids: row?.recycled_ids ?? [] });
    }

    if (mode === 'force_recycle_reservation') {
      const id = Number(body?.reservation_id);
      const reason = String(body?.reason || 'manual_force_recycle').slice(0, 100);
      if (!Number.isFinite(id) || id <= 0) return json({ ok: false, error: 'reservation_id required' }, 400);
      const { data, error } = await supa.rpc('bsr_force_recycle_reservation', {
        _reservation_id: id, _reason: reason,
      });
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, recycled: Boolean(data), reservation_id: id, reason });
    }

    if (mode === 'enqueue') {
      const requested = String(body?.date || taipeiToday());
      const effectiveDate = (!body?.date && !isAfterClose())
        ? rollBackToWeekday(addDays(taipeiToday(), -1))
        : rollBackToWeekday(requested);
      const state = await loadDegradeState();
      const policy = policyOf(state.mode);
      const tiers: Record<string, number | string> = {};
      const cid = crypto.randomUUID();
      // Stage B：整個 enqueue 請求讀一次 admission status，per-chunk 依此判定。
      const ctx: EnqueueCtx = {
        admission: await fetchAdmissionStatus(supa as unknown as GateRpcClient),
        chunks: [],
      };
      const doTier1 = body?.tier1 !== false;
      const doTier2 = body?.tier2 !== false;
      const doTier3Req = body?.tier3 === true;
      const doTier3 = doTier3Req && policy.allowEnqueueTier3;
      const backfillDays = Math.max(1, Math.min(30, Number(body?.backfill_days ?? 5)));
      if (doTier1) tiers.tier1 = await enqueueTier1Holdings(effectiveDate, cid, ctx);
      if (doTier2) tiers.tier2 = await enqueueTier2Gaps(effectiveDate, cid, ctx);
      if (doTier3) tiers.tier3 = await enqueueTier3Backfill(effectiveDate, backfillDays, cid, ctx);
      else if (doTier3Req) tiers.tier3 = 'skipped_by_degrade';
      const chunkSummary = summarizeChunks(ctx.chunks);
      console.log(JSON.stringify({
        fn: 'tw-bsr-finmind-sync', mode: 'enqueue', correlation_id: cid,
        admission_decision: ctx.admission.decision,
        admission_reason: ctx.admission.reason ?? ctx.admission.detail,
        gate_version: ctx.admission.version,
        ...chunkSummary,
      }));
      return json({
        ok: true, mode, date: effectiveDate, pre_close_rolled: effectiveDate !== requested,
        enqueued: tiers, correlation_id: cid, degrade_mode: state.mode,
        admission: {
          decision: ctx.admission.decision,
          blocked: ctx.admission.blocked,
          reason: ctx.admission.reason ?? ctx.admission.detail,
          terminal_code: ctx.admission.terminalCode,
          gate_version: ctx.admission.version,
        },
        admission_accounting: chunkSummary,
      });
    }

    if (mode === 'worker') {
      const batch = Math.max(1, Math.min(100, Number(body?.batch ?? 30)));
      const maxPriority = Math.max(1, Math.min(3, Number(body?.max_priority ?? 3)));
      const budgetMs = Math.max(5_000, Math.min(120_000, Number(body?.budget_ms ?? 45_000)));
      return json(await runWorker(batch, maxPriority, budgetMs));
    }

    if (mode === 'manual') {
      const date = rollBackToWeekday(String(body?.date || taipeiToday()));
      const ids: string[] = Array.isArray(body?.stock_ids)
        ? body.stock_ids.map((s: any) => String(s).trim()).filter(isChipEligible)
        : [];

      if (ids.length === 0) return json({ ok: false, error: 'stock_ids required (chip-eligible only)' }, 400);
      const priority = Math.max(1, Math.min(3, Number(body?.priority ?? 1)));
      const cid = crypto.randomUUID();
      const manualCtx: EnqueueCtx = {
        admission: await fetchAdmissionStatus(supa as unknown as GateRpcClient),
        chunks: [],
      };
      // Stage B fail-closed：manual 是獨立的 admin 入口，和 worker/enqueue 同一條規則。
      // blocked / gate row 缺 / 形狀錯 / status RPC error 一律不入隊、不打 provider。
      if (!manualCtx.admission.allowed) {
        return json({
          ok: true,
          mode,
          date,
          requested: ids.length,
          enqueued: 0,
          note: 'admission_gate_closed',
          jobs: [],
          correlation_id: cid,
          admission: {
            decision: manualCtx.admission.decision,
            blocked: manualCtx.admission.blocked,
            reason: manualCtx.admission.reason ?? manualCtx.admission.detail,
            terminal_code: manualCtx.admission.terminalCode,
            gate_version: manualCtx.admission.version,
          },
          admission_accounting: summarizeChunks(manualCtx.chunks),
        });
      }
      const enqueued = await enqueueBatch(ids, date, priority, 'manual', cid, false, manualCtx);

      const { data: jobs } = await supa.from('tw_bsr_sync_queue')
        .select('stock_id, correlation_id, priority, status, attempts, next_run_at, last_error, last_success_at')
        .in('stock_id', ids).eq('trade_date', date);
      const rl = await checkRateLimit(supa);
      return json({
        ok: true, mode, date, requested: ids.length, enqueued,
        rate_limit: rl, jobs: jobs ?? [], correlation_id: cid,
        admission: {
          decision: manualCtx.admission.decision,
          blocked: manualCtx.admission.blocked,
          reason: manualCtx.admission.reason ?? manualCtx.admission.detail,
          gate_version: manualCtx.admission.version,
        },
        admission_accounting: summarizeChunks(manualCtx.chunks),
        note: 'manual sync 已入隊；查 GET stats 或 trace mode + correlation_id 追蹤',
      });
    }

    if (mode === 'probe') {
      // 探測 FinMind 是否支援 market-batch（省略 data_id 一次抓整市場）。
      const force = Boolean(body?.force);
      const probeDate = body?.date ? String(body.date) : undefined;
      const result = await probeMarketBatchSupport(supa, { force, probeDate });
      return json({ ok: true, mode, ...result });
    }

    if (mode === 'market_batch_toggle') {
      // Kill switch：管理員手動關/開 Phase A（不動 supported 探測結果）
      if (typeof body?.enabled !== 'boolean') return json({ ok: false, error: 'enabled(boolean) required' }, 400);
      await updateMarketBatchConfig(supa, { enabled: body.enabled });
      const cfg = await loadMarketBatchConfig(supa);
      return json({ ok: true, mode, config: cfg });
    }


    if (mode === 'snapshot_stats') {
      const days = Math.max(1, Math.min(60, Number(body?.days ?? 14)));
      const { data, error } = await supa.rpc('bsr_snapshot_stats', { _days: days });
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, mode, days, snapshots: data ?? [] });
    }

    if (mode === 'snapshot_fulfill') {
      // 手動觸發：對指定日期 raw data 已在庫（例如已手動 upsert）時，僅執行「把 job 標 done」。
      const date = String(body?.date || '');
      if (!date) return json({ ok: false, error: 'date required' }, 400);
      const result = await fulfillJobsFromSnapshot(supa, date);
      return json({ ok: true, mode, date, ...result });
    }

    return json({ ok: false, error: `unknown mode: ${mode}` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('tw-bsr-finmind-sync fatal:', msg);
    return json({ ok: false, error: msg }, 500);
  }
});
