import { INDUSTRY_CODES, industryCodeOf, reviewedPeerOverride } from './industryCodes';
import type { PeerGroup } from './valuationStations';

/** Keep curated priority; fill only from adopted classifications, never pending rows. */
export function buildLivePeerGroups(map: Record<string, { industries?: string[] }>, groups: PeerGroup[]): PeerGroup[] {
  const stocks = Object.entries(map).map(([symbol, row]) => ({ symbol, adopted: true, codes: (row.industries ?? []).map((i) => industryCodeOf(i)).filter((c): c is string => c !== null) }));
  const out: PeerGroup[] = [];
  for (const c of INDUSTRY_CODES.filter((c) => !c.retired)) {
    const g = groups.find((g) => !g.custom && g.code === c.code);
    const o = reviewedPeerOverride({ code: c.code, key: c.code, label: c.name, pickedAt: g?.pickedAt ?? '', include: g?.include ?? [], exclude: g?.exclude ?? [] }, stocks);
    const candidates = stocks.filter((s) => s.codes[0] === c.code && !o.exclude.includes(s.symbol)).map((s) => s.symbol).sort();
    const valid = new Set(candidates);
    const curated = o.include.filter((s) => !o.exclude.includes(s));
    const symbols = Array.from(new Set([...curated, ...(g?.symbols ?? []).filter((s) => valid.has(s)), ...candidates])).slice(0, Math.max(12, curated.length));
    if (symbols.length) out.push({ ...g, key: g?.key ?? c.code, code: c.code, label: c.name, pickedAt: g?.pickedAt ?? '', symbols });
  }
  return out;
}