/**
 * 台股「張 ↔ 股」換算的唯一資料源（前台）。
 *
 * 憲法：DB 一律以「股」儲存（見 ADR-0003 Base Unit），「張」只是台股 UI 顯示層。
 * 任何地方都不得再出現裸的 `* 1000` / `/ 1000` 做張股換算 —— 一律走這裡。
 *
 * Edge Function（Deno）側的鏡像在 supabase/functions/_shared/lotSize.ts，
 * 由 src/test/unit/lot-size-single-source.test.ts 做 parity 守衛。
 */

/** 1 張 = 1000 股。 */
export const SHARES_PER_LOT = 1000;

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** 張 → 股。 */
export function lotsToShares(lots: unknown): number {
  return num(lots) * SHARES_PER_LOT;
}

/**
 * 股 → 張。
 * `round` 預設 'exact'（可能有小數，適合精算）；'nearest' 供顯示用四捨五入。
 */
export function sharesToLots(
  shares: unknown,
  round: 'exact' | 'nearest' | 'floor' = 'exact',
): number {
  const lots = num(shares) / SHARES_PER_LOT;
  if (round === 'nearest') return Math.round(lots);
  if (round === 'floor') return Math.floor(lots);
  return lots;
}

/** 是否為整張（零股會回 false）。 */
export function isWholeLot(shares: unknown): boolean {
  const n = num(shares);
  return n !== 0 && n % SHARES_PER_LOT === 0;
}

export interface FormatLotsOptions {
  /** 正數是否補 `+`（籌碼面買賣超用）。 */
  signed?: boolean;
  /** 單位後綴，預設「張」。 */
  suffix?: string;
  /** 不足 1 張時的顯示，預設 `<1 張`；傳 null 則顯示 0。 */
  subLotLabel?: string | null;
  locale?: string;
}

/** 把「股」格式化成人看的「張」字串。 */
export function formatSharesAsLots(
  shares: number | null | undefined,
  options: FormatLotsOptions = {},
): string {
  if (shares == null || Number.isNaN(Number(shares))) return '—';
  const { signed = false, suffix = '張', subLotLabel = '<1 張', locale = 'zh-TW' } = options;
  const lots = sharesToLots(shares, 'nearest');
  if (lots === 0) {
    if (Number(shares) === 0) return '0';
    return subLotLabel ?? '0';
  }
  const sign = signed && lots > 0 ? '+' : '';
  return `${sign}${lots.toLocaleString(locale)} ${suffix}`.trim();
}
