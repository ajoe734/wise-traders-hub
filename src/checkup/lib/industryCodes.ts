/**
 * industryCodes — 細分產業固定代碼（純函式，零 I/O）
 *
 * 唯一代碼表：`src/checkup/data/industryCodes.json`（由 scripts/build-peer-groups.ts 只增不改產生）。
 * 規則：代碼一經發出永不改號、不重用；改名只改 name，舊名進 aliases。
 */
import codesJson from '@/checkup/data/industryCodes.json';

export type IndustryCode = { code: string; name: string; sector: string; sectorCode: string; aliases: string[]; retired?: boolean };

export const INDUSTRY_CODES: IndustryCode[] = (codesJson as { codes: IndustryCode[] }).codes;
export const SECTOR_CODES: Record<string, string> = (codesJson as { sectors: Record<string, string> }).sectors;

/** 全形轉半形、斜線統一、去空白，供名稱比對 */
export function normalizeIndustryName(s: string): string {
  return String(s ?? '')
    .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .replace(/[\\|]/g, '/')
    .replace(/\s+/g, '')
    .toUpperCase();
}

export function buildCodeIndex(codes: IndustryCode[] = INDUSTRY_CODES): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of codes) {
    for (const n of [c.name, ...c.aliases]) m.set(normalizeIndustryName(n), c.code);
  }
  return m;
}

const INDEX = buildCodeIndex();

/** 名稱（含別名、全半形差異）→ 代碼；已是代碼則原樣回傳；對不到回 null，不猜 */
export function industryCodeOf(nameOrCode: string | null | undefined, codes: IndustryCode[] = INDUSTRY_CODES): string | null {
  if (!nameOrCode) return null;
  const raw = String(nameOrCode).trim();
  if (codes.some((c) => c.code === raw)) return raw;
  const idx = codes === INDUSTRY_CODES ? INDEX : buildCodeIndex(codes);
  return idx.get(normalizeIndustryName(raw)) ?? null;
}

export function industryByCode(code: string, codes: IndustryCode[] = INDUSTRY_CODES): IndustryCode | null {
  return codes.find((c) => c.code === code) ?? null;
}

/**
 * 只增不改：保留舊代碼，字典新增的細分產業依大類流水號往後發號；
 * 字典移除的產業標 retired，不刪不重用。
 */
export function assignCodes(
  taxonomy: Record<string, string[]>,
  sectors: Record<string, string>,
  existing: IndustryCode[] = [],
): IndustryCode[] {
  const out = existing.map((c) => ({ ...c, aliases: [...c.aliases] }));
  const byName = new Map(out.map((c) => [normalizeIndustryName(c.name), c]));
  const aliasOf = buildCodeIndex(out);
  const live = new Set<string>();
  for (const [sector, list] of Object.entries(taxonomy)) {
    const sc = sectors[sector];
    if (!sc) throw new Error(`大類「${sector}」沒有大類代碼`);
    for (const name of list) {
      const key = normalizeIndustryName(name);
      let hit = byName.get(key) ?? out.find((c) => c.code === aliasOf.get(key));
      if (!hit) {
        const used = out.filter((c) => c.sectorCode === sc).map((c) => Number(c.code.split('-')[1]));
        const next = (used.length ? Math.max(...used) : 0) + 1;
        hit = { code: `${sc}-${String(next).padStart(2, '0')}`, name, sector, sectorCode: sc, aliases: [] };
        out.push(hit);
        byName.set(key, hit);
      } else if (hit.name !== name) {
        if (!hit.aliases.includes(hit.name)) hit.aliases.push(hit.name);
        hit.name = name;
      }
      delete hit.retired;
      live.add(hit.code);
    }
  }
  for (const c of out) if (!live.has(c.code)) c.retired = true;
  return out;
}

export type PeerOverride = { code: string | null; key: string; label: string; pickedAt: string; include: string[]; exclude: string[]; custom?: boolean };
export type StockRow = { symbol: string; industry: string | null; cap: number | null };

/** 審核後名單只保留已採用且有同產業證據者；跨產業自訂組只檢查採用狀態。 */
export function reviewedPeerOverride(
  override: PeerOverride,
  stocks: Array<{ symbol: string; adopted: boolean; codes: string[] }>,
): PeerOverride {
  const bySymbol = new Map(stocks.map((s) => [s.symbol, s]));
  const rejected = override.include.filter((symbol) => {
    const stock = bySymbol.get(symbol);
    return !stock?.adopted || (!override.custom && (!override.code || !stock.codes.includes(override.code)));
  });
  return { ...override, exclude: Array.from(new Set([...override.exclude, ...rejected])) };
}

/** 依代碼自動組名單：同主產業代碼、市值降冪（無市值排後、依代號），取前 n；人工排除優先、人工加入保留 */
export function composePeerSymbols(
  code: string,
  stocks: Array<StockRow & { code: string | null }>,
  override: Pick<PeerOverride, 'include' | 'exclude'> | null,
  n = 12,
): string[] {
  const ex = new Set(override?.exclude ?? []);
  const auto = stocks
    .filter((s) => s.code === code && !ex.has(s.symbol))
    .sort((a, b) => (b.cap ?? -1) - (a.cap ?? -1) || a.symbol.localeCompare(b.symbol))
    .map((s) => s.symbol);
  const inc = (override?.include ?? []).filter((s) => !ex.has(s));
  const out: string[] = [...inc];
  for (const s of auto) {
    if (out.length >= Math.max(n, inc.length)) break;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}
