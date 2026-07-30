/**
 * 台股「張 ↔ 股」換算的唯一資料源（Edge Function / Deno 側）。
 *
 * 前台鏡像：src/lib/lotSize.ts。兩份的 SHARES_PER_LOT 由
 * src/test/unit/lot-size-single-source.test.ts 做 parity 守衛。
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

/** 股 → 張。 */
export function sharesToLots(
  shares: unknown,
  round: 'exact' | 'nearest' | 'floor' = 'exact',
): number {
  const lots = num(shares) / SHARES_PER_LOT;
  if (round === 'nearest') return Math.round(lots);
  if (round === 'floor') return Math.floor(lots);
  return lots;
}

/** 是否為整張。 */
export function isWholeLot(shares: unknown): boolean {
  const n = num(shares);
  return n !== 0 && n % SHARES_PER_LOT === 0;
}
