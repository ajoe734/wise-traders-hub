import { industryCodeOf, industryByCode } from './industryCodes';

export type AdoptedIndustryMap = Record<string, { industries?: string[] }>;

/** The map has already passed the adoption gate; no broad/secondary/custom fallback. */
export function filterSupplyChainPeers<T extends { symbol: string }>(
  symbol: string, peers: T[], map: AdoptedIndustryMap,
): T[] {
  const code = industryCodeOf(map[symbol]?.industries?.[0]);
  if (!code || industryByCode(code)?.retired) return [];
  const seen = new Set<string>([symbol]);
  return peers.filter((peer) => {
    if (seen.has(peer.symbol) || industryCodeOf(map[peer.symbol]?.industries?.[0]) !== code) return false;
    seen.add(peer.symbol);
    return true;
  });
}