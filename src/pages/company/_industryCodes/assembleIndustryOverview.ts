// 產業分類總覽頁的純組裝函式：把產業代碼表、同業名單、產業對應與股票名稱
// 組成畫面用的 view model。零 I/O，方便單元測試。

export interface IndustryCodeRow {
  code: string;
  name: string;
  sector: string;
  sectorCode: string;
  aliases?: string[];
  retired?: boolean;
}

export interface PeerGroupRow {
  key: string;
  code?: string;
  label: string;
  custom?: boolean;
  curation?: string;
  include?: string[];
  exclude?: string[];
  symbols: string[];
}

export type StockNameMap = Record<string, string>;

export interface PeerMemberView {
  symbol: string;
  name: string;
  source: 'manual' | 'auto';
}

export interface IndustryCodeView {
  code: string;
  name: string;
  sector: string;
  sectorCode: string;
  aliases: string[];
  retired: boolean;
  /** 該產業對應到的股票總數（全市場） */
  stockCount: number;
  /** 對應的同業名單；null = 沒有名單 */
  peerGroup: {
    key: string;
    label: string;
    curation: string;
    members: PeerMemberView[];
    excludes: { symbol: string; name: string }[];
  } | null;
}

export interface CustomGroupView {
  key: string;
  label: string;
  curation: string;
  members: PeerMemberView[];
  excludes: { symbol: string; name: string }[];
}

export interface SectorSection {
  sectorCode: string;
  sector: string;
  rows: IndustryCodeView[];
}

const nameOf = (names: StockNameMap, symbol: string): string => names[symbol] ?? '';

const memberSource = (group: PeerGroupRow, symbol: string): 'manual' | 'auto' =>
  (group.include ?? []).includes(symbol) ? 'manual' : 'auto';

const toMembers = (group: PeerGroupRow, names: StockNameMap): PeerMemberView[] =>
  group.symbols.map((symbol) => ({
    symbol,
    name: nameOf(names, symbol),
    source: memberSource(group, symbol),
  }));

const toExcludes = (group: PeerGroupRow, names: StockNameMap) =>
  (group.exclude ?? []).map((symbol) => ({ symbol, name: nameOf(names, symbol) }));

/**
 * 組裝產業代碼總覽。
 * @param codes 產業代碼表（industryCodes.json）
 * @param groups 同業名單（valuationPeerGroups.json）
 * @param industryCounts 產業名稱 → 全市場股票數（由 twseSecondaryIndustry.json 統計）
 * @param names 股票代號 → 公司名稱
 */
export function assembleIndustryOverview(
  codes: IndustryCodeRow[],
  groups: PeerGroupRow[],
  industryCounts: Record<string, number>,
  names: StockNameMap,
): { sections: SectorSection[]; customGroups: CustomGroupView[] } {
  const groupByCode = new Map<string, PeerGroupRow>();
  const customGroups: CustomGroupView[] = [];

  for (const g of groups) {
    if (g.custom || !g.code) {
      customGroups.push({
        key: g.key,
        label: g.label,
        curation: g.curation ?? '',
        members: toMembers(g, names),
        excludes: toExcludes(g, names),
      });
      continue;
    }
    groupByCode.set(g.code, g);
  }

  const sectorOrder: string[] = [];
  const bySector = new Map<string, IndustryCodeView[]>();

  for (const c of codes) {
    const g = groupByCode.get(c.code) ?? null;
    const view: IndustryCodeView = {
      code: c.code,
      name: c.name,
      sector: c.sector,
      sectorCode: c.sectorCode,
      aliases: c.aliases ?? [],
      retired: c.retired ?? false,
      stockCount: industryCounts[c.name] ?? 0,
      peerGroup: g
        ? {
            key: g.key,
            label: g.label,
            curation: g.curation ?? '',
            members: toMembers(g, names),
            excludes: toExcludes(g, names),
          }
        : null,
    };
    if (!bySector.has(c.sectorCode)) {
      bySector.set(c.sectorCode, []);
      sectorOrder.push(c.sectorCode);
    }
    bySector.get(c.sectorCode)!.push(view);
  }

  const sections: SectorSection[] = sectorOrder.map((sectorCode) => {
    const rows = bySector.get(sectorCode)!;
    return { sectorCode, sector: rows[0]?.sector ?? sectorCode, rows };
  });

  return { sections, customGroups };
}

/** 搜尋：比對產業名稱、代碼、別名、成員股票代號或公司名稱。回傳符合的產業代碼與自訂組 key。 */
export function filterIndustryOverview(
  query: string,
  sections: SectorSection[],
  customGroups: CustomGroupView[],
): { codes: Set<string>; customKeys: Set<string> } {
  const q = query.trim().toLowerCase();
  const codes = new Set<string>();
  const customKeys = new Set<string>();
  if (!q) return { codes, customKeys };

  const memberHit = (members: PeerMemberView[]) =>
    members.some((m) => m.symbol.toLowerCase().includes(q) || m.name.toLowerCase().includes(q));

  for (const s of sections) {
    for (const r of s.rows) {
      if (
        r.code.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.aliases.some((a) => a.toLowerCase().includes(q)) ||
        (r.peerGroup && memberHit(r.peerGroup.members))
      ) {
        codes.add(r.code);
      }
    }
  }
  for (const g of customGroups) {
    if (g.label.toLowerCase().includes(q) || g.key.toLowerCase().includes(q) || memberHit(g.members)) {
      customKeys.add(g.key);
    }
  }
  return { codes, customKeys };
}
