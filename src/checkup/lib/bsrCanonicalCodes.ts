/**
 * bsrCanonicalCodes — BSR（券商分點）不可用語意的**唯一映射來源**。
 *
 * 為什麼存在：同一件事（上游方案不支援全市場分點）在四層各有不同字串：
 *   DB terminal code   : 'bsr_provider_unsupported'
 *   gate reason        : 'provider_plan_rejected'
 *   前端 provider state: 'terminal_provider_rejected'
 *   分段新鮮度 seg state: 'unavailable_unsupported'
 * 過去這四個字串散落在 hook／元件／edge，任何一層改名就會有一處悄悄失準。
 * 此模組把「代碼映射」與「使用者可見文案」都收成單一資料源。
 *
 * 憲法：
 *   - 對使用者可見的文字**絕不**出現 provider 名稱、方案／level、HTTP 狀態碼、
 *     內部 code，也不得出現「此股票不支援」「上游來源中止」這類舊文案。
 *   - 這裡不打 API、不碰 DOM、不寫狀態，純函式，可單測。
 */

export const BSR_TERMINAL_DB_CODE = 'bsr_provider_unsupported';
export const BSR_TERMINAL_GATE_REASON = 'provider_plan_rejected';
export const BSR_TERMINAL_PROVIDER_STATE = 'terminal_provider_rejected';
export const BSR_TERMINAL_SEG_STATE = 'unavailable_unsupported';

/** 任一層看到這些輸入，都代表同一個 terminal 事實。 */
const TERMINAL_INPUTS: ReadonlySet<string> = new Set([
  BSR_TERMINAL_DB_CODE,
  BSR_TERMINAL_GATE_REASON,
  BSR_TERMINAL_PROVIDER_STATE,
  BSR_TERMINAL_SEG_STATE,
]);

/* ── 使用者可見文案（唯一定義處）─────────────────────────────── */

/** terminal／partial error 共用：不承諾時間、不指名上游。 */
export const BSR_TEXT_UNAVAILABLE = '籌碼資料暫時無法取得';
export const BSR_TEXT_SYNCING = '籌碼資料更新中';
/** 只在 payload providerState==='ineligible' 時使用。 */
export const BSR_TEXT_INELIGIBLE = '不適用（ETF／權證／受益憑證）';
/** 本地未通過台股 batch canonical validator（例：美股代號）。 */
export const BSR_TEXT_NOT_APPLICABLE = '籌碼資料不適用';

/** `2026-08-14` → `2026/08/14`；無值回 null。 */
export function formatBsrAsOf(asOf: string | null | undefined): string | null {
  if (!asOf) return null;
  return String(asOf).split('-').join('/');
}

/**
 * 把任一層的輸入收斂成前端 provider state。
 * - 字串：terminal 家族一律回 `terminal_provider_rejected`，其餘原樣回傳。
 * - 物件（payload 形狀）：讀 `bsr_provider_state` / `bsr_sync_status.provider_state`
 *   / `bsr_terminal_code` / `bsr_provider_code` 後再收斂。
 */
export function mapProviderState(input: unknown): string | null {
  if (input == null) return null;
  if (typeof input === 'string') {
    const s = input.trim();
    if (!s) return null;
    return TERMINAL_INPUTS.has(s) ? BSR_TERMINAL_PROVIDER_STATE : s;
  }
  if (typeof input === 'object') {
    const p = input as {
      bsr_provider_state?: unknown;
      bsr_terminal_code?: unknown;
      bsr_provider_code?: unknown;
      bsr_sync_status?: { provider_state?: unknown; provider_code?: unknown } | null;
      providerState?: unknown;
      providerCode?: unknown;
    };
    const candidates = [
      p.bsr_provider_state,
      p.bsr_sync_status?.provider_state,
      p.bsr_terminal_code,
      p.bsr_provider_code,
      p.bsr_sync_status?.provider_code,
      p.providerState,
      p.providerCode,
    ];
    let first: string | null = null;
    for (const c of candidates) {
      const mapped = typeof c === 'string' ? mapProviderState(c) : null;
      if (!mapped) continue;
      if (mapped === BSR_TERMINAL_PROVIDER_STATE) return BSR_TERMINAL_PROVIDER_STATE;
      if (!first) first = mapped;
    }
    return first;
  }
  return null;
}

/** terminal（永久拒絕）判定：provider state 或 provider code 任一命中即成立。 */
export function isTerminalUnavailable(input: {
  providerState?: string | null;
  providerCode?: string | null;
} | null | undefined): boolean {
  if (!input) return false;
  return (
    mapProviderState(input.providerState ?? null) === BSR_TERMINAL_PROVIDER_STATE ||
    mapProviderState(input.providerCode ?? null) === BSR_TERMINAL_PROVIDER_STATE
  );
}

/**
 * D4 fail-closed 閘：terminal（永久拒絕）時**絕不**允許任何回補請求。
 * 唯一判斷來源就是 canonical mapper 攤平後的 `terminalUnavailable`。
 */
export function canRequestBackfill(
  facts: { terminalUnavailable?: boolean | null } | null | undefined,
): boolean {
  return !facts?.terminalUnavailable;
}

/* ── 卡片層 UI 狀態 ─────────────────────────────────────────── */

export type BsrUiState =
  | 'loading'
  | 'available'
  | 'syncing'
  | 'degraded'
  | 'partial_error'
  | 'unavailable_unsupported'
  | 'ineligible'
  | 'not_applicable';

/** 卡片 batch 狀態（寫在 `['tw-chips-batch-status', code]`）。 */
export interface BsrBatchStatusLike {
  kind: 'pending' | 'ok' | 'error' | 'not_applicable';
  runId?: number;
  at?: number;
  reason?: string;
}

interface PayloadLike {
  bsr_as_of?: string | null;
  bsr_provider_state?: string | null;
  bsr_freshness_status?: string | null;
  bsr_sync_status?: { provider_state?: string | null; provider_code?: string | null } | null;
  bsr_terminal_code?: string | null;
  bsr_provider_code?: string | null;
}

function providerStateToUi(payload: PayloadLike): BsrUiState {
  const ps = mapProviderState(payload);
  if (ps === BSR_TERMINAL_PROVIDER_STATE) return 'unavailable_unsupported';
  if (ps === 'ineligible') return 'ineligible';
  if (ps === 'unknown_degraded') return 'degraded';
  if (ps === 'retryable') return 'syncing';
  switch (payload.bsr_freshness_status) {
    case 'fresh':
      return 'available';
    case 'syncing':
      return 'syncing';
    case 'lagging':
      return 'degraded';
    case 'ineligible':
      return 'ineligible';
    case 'sync_failed':
    case 'not_queued':
    case 'no_data':
      return 'unavailable_unsupported';
    default:
      return payload.bsr_as_of ? 'available' : 'syncing';
  }
}

/**
 * 卡片狀態優先序（Plan v3 §D，先命中先返回）：
 *   1. payload 的權威 terminal / ineligible（不被 batch error 蓋掉）
 *   2. batch error → partial_error（即使有 stale payload）
 *   3. batch not_applicable → not_applicable（不得映射成 ineligible）
 *   4. batch ok + payload → 依 provider state
 *   5. batch pending + payload → syncing（顯示 last-known，不閃回 loading）
 *   6. 其餘 → loading
 */
export function resolveCardBsrState(
  chipsData?: { payload?: PayloadLike | null } | null,
  status?: BsrBatchStatusLike | null,
): BsrUiState {
  const payload = chipsData?.payload ?? null;
  if (payload) {
    const ps = mapProviderState(payload);
    if (ps === BSR_TERMINAL_PROVIDER_STATE) return 'unavailable_unsupported';
    if (ps === 'ineligible') return 'ineligible';
  }
  if (status?.kind === 'error') return 'partial_error';
  if (status?.kind === 'not_applicable') return 'not_applicable';
  if (payload && status?.kind === 'pending') return 'syncing';
  if (payload) return providerStateToUi(payload);
  return 'loading';
}

/** 卡片可見文案；`available` / `loading` 不顯示任何字（回空字串）。 */
export function bsrStateText(state: BsrUiState, asOf?: string | null): string {
  const d = formatBsrAsOf(asOf);
  switch (state) {
    case 'unavailable_unsupported':
    case 'partial_error':
      return d ? `${BSR_TEXT_UNAVAILABLE} · 顯示最後可得資料 ${d}` : BSR_TEXT_UNAVAILABLE;
    case 'syncing':
      return BSR_TEXT_SYNCING;
    // degraded（lagging／unknown_degraded）仍有可用資料，卡片不加字，
    // 細節交給抽屜的分段新鮮度；不得在卡片謊稱「更新中」。
    case 'degraded':
      return '';
    case 'ineligible':
      return BSR_TEXT_INELIGIBLE;
    case 'not_applicable':
      return BSR_TEXT_NOT_APPLICABLE;
    default:
      return '';
  }
}
