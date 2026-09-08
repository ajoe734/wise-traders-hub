/**
 * cardChipsLine — 持倉卡片「籌碼行」文案的單一資料源（純函式）。
 *
 * 為什麼存在：籌碼面其實是兩個獨立來源
 *   - 三大法人（TWSE T86 / TPEx）：每交易日持續同步，通常是最新交易日。
 *   - 券商分點 BSR：上游方案權限被拒後永久停更。
 * 卡片過去只讀 BSR，於是整張卡顯示「籌碼資料暫時無法取得 · 最後可得 2026/08/14」，
 * 使用者誤以為連法人資料都停更三週。這裡讓卡片以「實際可得的最新籌碼事實」為主，
 * BSR 不可用只能是附註。
 *
 * 憲法：不打 API、不碰 DOM、不製造資料；沒有事實就回既有 BSR 文案或空字串。
 */
import { formatSharesAsLots } from '@/lib/lotSize';
import { bsrStateText, formatBsrAsOf, type BsrUiState } from './bsrCanonicalCodes';

export interface CardChipsPayloadLike {
  as_of?: string | null;
  institutional?: {
    d1?: { foreign_net?: number | null; total_net?: number | null; days_covered?: number | null } | null;
  } | null;
  bsr_as_of?: string | null;
}

export interface CardChipsLine {
  /** 'institutional' = 以法人事實為主；'bsr' = 只有 BSR 狀態可講；'none' = 無事可講 */
  kind: 'institutional' | 'bsr' | 'none';
  text: string;
  /** 法人資料日期（原始 YYYY-MM-DD），無則 null */
  instAsOf: string | null;
}

/** BSR 不可用（需要在法人行後面加附註）的狀態集合。 */
const BSR_NOTE_STATES: ReadonlySet<BsrUiState> = new Set<BsrUiState>([
  'unavailable_unsupported',
  'partial_error',
]);

export function resolveCardChipsLine(
  payload: CardChipsPayloadLike | null | undefined,
  bsrState: BsrUiState,
): CardChipsLine {
  const instAsOf = payload?.as_of ? String(payload.as_of) : null;
  const d1 = payload?.institutional?.d1 ?? null;
  const hasInst = Boolean(instAsOf && d1 && Number.isFinite(Number(d1.foreign_net ?? d1.total_net)));

  if (hasInst) {
    const net = Number(d1?.foreign_net ?? d1?.total_net ?? 0);
    const lots = formatSharesAsLots(net, { signed: true, suffix: '', subLotLabel: '0' });
    const head = `三大法人 ${formatBsrAsOf(instAsOf)} · 外資 ${lots} 張`;
    const note = BSR_NOTE_STATES.has(bsrState) ? ' · 券商分點暫無' : '';
    return { kind: 'institutional', text: `${head}${note}`, instAsOf };
  }

  const fallback = bsrStateText(bsrState, payload?.bsr_as_of ?? null);
  return { kind: fallback ? 'bsr' : 'none', text: fallback, instAsOf: null };
}
