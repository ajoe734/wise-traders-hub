// Deno-side OCC helper — mirrors src/lib/optionCombo.ts::buildOccSymbol
// Kept local (no cross-tree import) so the edge function has zero project deps.
export type OptionRight = 'C' | 'P';

export function buildOccSymbol(leg: {
  underlying: string;
  expiry: string; // YYYY-MM-DD
  right: OptionRight;
  strike: number;
}): string {
  const root = String(leg.underlying || '').trim().toUpperCase();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(leg.expiry || '').trim());
  if (!root || !m) return '';
  const yymmdd = `${m[1].slice(2)}${m[2]}${m[3]}`;
  const strikeInt = Math.round(Number(leg.strike || 0) * 1000);
  if (!Number.isFinite(strikeInt) || strikeInt <= 0) return '';
  return `${root}${yymmdd}${leg.right}${String(strikeInt).padStart(8, '0')}`;
}
