import { resolveChainClassification, type ChainMember, type ChainSourceMap, type ChainResolution } from './chainClassification.ts';

export interface ChainReviewRow {
  symbol: string;
  industries?: string[] | null;
  revenue_mix?: Array<{ industry: string; pct: number }> | null;
  reviewed?: boolean | null;
  confidence?: number | null;
  evidence?: string | null;
  updated_at?: string | null;
}

/** Every pending stock gets an outcome; exact, unambiguous approved names handle new source codes. */
export function buildChainReview(input: {
  rows: ChainReviewRow[];
  members: Array<ChainMember & { symbol: string }>;
  map: ChainSourceMap;
  isValidIndustry: (name: string) => boolean;
  isAdoptedClassification: (row: ChainReviewRow) => boolean;
}) {
  const map = { ...input.map };
  const names = new Map<string, Set<string>>();
  for (const entry of Object.values(map)) {
    if (!input.isValidIndustry(entry.industry)) continue;
    const set = names.get(entry.subItem.trim()) ?? new Set<string>();
    set.add(entry.industry);
    names.set(entry.subItem.trim(), set);
  }
  const unmapped = new Map<string, { subCode: string; subItem: string }>();
  const bySymbol = new Map<string, ChainMember[]>();
  for (const m of input.members) {
    if (!map[m.subCode]) {
      const matches = names.get(m.subItem.trim());
      const industry = matches?.size === 1 ? Array.from(matches)[0] : undefined;
      if (industry) map[m.subCode] = { subItem: m.subItem, industry };
    }
    if (!map[m.subCode] || !input.isValidIndustry(map[m.subCode].industry)) {
      unmapped.set(`${m.subCode}:${m.subItem}`, { subCode: m.subCode, subItem: m.subItem });
    }
    bySymbol.set(m.symbol, [...(bySymbol.get(m.symbol) ?? []), m]);
  }
  const results: Array<ChainResolution & { symbol: string }> = [];
  const counts = { adopted: 0, conflict: 0, diversified: 0, unmapped: 0, no_source: 0 };
  let skipped = 0;
  for (const row of input.rows) {
    if (input.isAdoptedClassification(row)) { skipped++; continue; }
    const r = resolveChainClassification({ members: bySymbol.get(row.symbol) ?? [], current: row.industries, revenueMix: row.revenue_mix, map, isValidIndustry: input.isValidIndustry });
    counts[r.status]++;
    results.push({ symbol: row.symbol, ...r });
  }
  return { results, counts, skipped, unmapped: Array.from(unmapped.values()).sort((a, b) => a.subCode.localeCompare(b.subCode)) };
}