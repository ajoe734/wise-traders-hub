/**
 * cardChipsFact — 卡片層「籌碼面」的唯一選擇器。
 *
 * 為什麼存在：券商分點（BSR）與三大法人是**兩個獨立上游**。BSR 目前沒有免驗證碼且
 * 已授權的官方全市場來源（upstream entitlement blocked，最後可得 2026/08/14），
 * 但三大法人（TWSE T86／TPEx 三大法人）每交易日都有新資料。過去卡片只讀 BSR，
 * 於是整張卡對使用者顯示「籌碼資料暫時無法取得」，把可用的資料一起隱藏掉。
 *
 * 憲法：
 *   - 只讀實際 serving payload rows 決定顯示，缺資料 fail-closed（不猜、不補 0）。
 *   - 三大法人與券商分點**不得混成同一指標**：法人是 primary，分點只在 secondary。
 *   - 純函式：不打 API、不碰 DOM、不寫狀態。
 *   - 單位：payload 為「股」，對使用者一律換算為「張」（1 張 = 1000 股）。
 */
import type { ChipsFetchResult } from '@/checkup/lib/chipsRepository';
import {
  resolveCardBsrState,
  bsrStateText,
  formatBsrAsOf,
  isTerminalUnavailable,
  type BsrUiState,
  type BsrBatchStatusLike,
} from '@/checkup/lib/bsrCanonicalCodes';

/** 券商分點 secondary 文案（唯一定義處）：不指名上游、不承諾時間。 */
export const BSR_TEXT_ENTITLEMENT = '券商分點資料源需授權';

export type CardChipsKind = 'loading' | 'institutional' | 'bsr_status' | 'not_applicable';

export interface CardChipsLots {
  foreign: number;
  trust: number;
  dealer: number;
  total: number;
}

export interface CardChipsFact {
  kind: CardChipsKind;
  /** 主要可見文字；`loading` 或無話可說時為空字串。 */
  text: string;
  /** 次要（券商分點）狀態；沒有就是 null。 */
  secondaryText: string | null;
  /** 三大法人資料日期（YYYY/MM/DD），無則 null。 */
  asOf: string | null;
  /** 換算後張數；只有 kind==='institutional' 時非 null。 */
  lots: CardChipsLots | null;
  bsrState: BsrUiState;
  bsrAsOf: string | null;
}

const SHARES_PER_LOT = 1000;

/** 股 → 張（保留正負號；小量給 1 位小數，避免整數化成 0 誤導）。 */
export function sharesToLots(shares: number): number {
  const lots = shares / SHARES_PER_LOT;
  return Math.abs(lots) < 10 ? Math.round(lots * 10) / 10 : Math.round(lots);
}

export function formatLots(shares: number): string {
  const lots = sharesToLots(shares);
  const sign = lots > 0 ? '+' : lots < 0 ? '−' : '';
  const abs = Math.abs(lots);
  const body = Number.isInteger(abs) ? abs.toLocaleString('en-US') : abs.toFixed(1);
  return `${sign}${body}`;
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * 決定卡片籌碼槽要顯示什麼。優先序：
 *   1. ETF／權證／非台股 → 不適用（不得被法人數值蓋掉）
 *   2. 有實際 d1 法人 rows（days_covered ≥ 1 且三個欄位皆為有限數）→ 法人 primary
 *   3. 其餘 → 沿用既有 BSR 狀態文案
 */
export function resolveCardChipsFact(
  chipsData?: ChipsFetchResult | null,
  status?: BsrBatchStatusLike | null,
): CardChipsFact {
  const payload = chipsData?.payload ?? null;
  const bsrState = resolveCardBsrState(chipsData ?? null, status ?? null);
  const bsrAsOf = payload?.bsr_as_of ?? null;

  const base = { bsrState, bsrAsOf, asOf: null as string | null, lots: null as CardChipsLots | null };

  if (bsrState === 'not_applicable' || bsrState === 'ineligible') {
    return { ...base, kind: 'not_applicable', text: bsrStateText(bsrState, bsrAsOf), secondaryText: null };
  }

  const d1 = payload?.institutional?.d1 ?? null;
  const instAsOf = payload?.as_of ?? null;
  const hasRows =
    !!d1 &&
    Number(d1.days_covered ?? 0) >= 1 &&
    finite(d1.foreign_net) &&
    finite(d1.trust_net) &&
    finite(d1.dealer_net) &&
    !!instAsOf;

  if (hasRows && d1 && instAsOf) {
    const lots: CardChipsLots = {
      foreign: sharesToLots(d1.foreign_net),
      trust: sharesToLots(d1.trust_net),
      dealer: sharesToLots(d1.dealer_net),
      total: sharesToLots(finite(d1.total_net) ? d1.total_net : d1.foreign_net + d1.trust_net + d1.dealer_net),
    };
    const asOf = formatBsrAsOf(instAsOf);
    const lag = Number(payload?.as_of_lag_days ?? 0);
    const lagSuffix = lag >= 5 ? `（落後 ${lag} 日）` : '';
    const text = `法人 ${asOf}${lagSuffix} · 外資 ${formatLots(d1.foreign_net)} · 投信 ${formatLots(
      d1.trust_net,
    )} · 自營 ${formatLots(d1.dealer_net)} 張`;

    return {
      ...base,
      kind: 'institutional',
      asOf,
      lots,
      text,
      secondaryText: buildBsrSecondary(payload, bsrState, bsrAsOf),
    };
  }

  const text = bsrStateText(bsrState, bsrAsOf);
  return { ...base, kind: text ? 'bsr_status' : 'loading', text, secondaryText: null };
}

function buildBsrSecondary(
  payload: NonNullable<ChipsFetchResult['payload']> | null,
  bsrState: BsrUiState,
  bsrAsOf: string | null,
): string | null {
  const terminal = isTerminalUnavailable({
    providerState: payload?.bsr_provider_state ?? payload?.bsr_sync_status?.provider_state ?? null,
    providerCode: payload?.bsr_provider_code ?? payload?.bsr_sync_status?.provider_code ?? null,
  });
  const d = formatBsrAsOf(bsrAsOf);
  if (terminal || bsrState === 'unavailable_unsupported') {
    return d ? `${BSR_TEXT_ENTITLEMENT} · 最後可得 ${d}` : BSR_TEXT_ENTITLEMENT;
  }
  const t = bsrStateText(bsrState, bsrAsOf);
  return t || null;
}

export default resolveCardChipsFact;
