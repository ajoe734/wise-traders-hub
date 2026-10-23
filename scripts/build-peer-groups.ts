/**
 * 產生產業代碼表與依代碼自動組的同業名單。
 *
 * 用法：bunx tsx scripts/build-peer-groups.ts <stocks.json> [report.md]
 *   stocks.json：[{ s: 代號, n: 名稱, i: 主細分產業, industries: 全部分類, adopted: 採用狀態, cap: 官方股數×最近收盤 }]
 *   （由 stock_industry_map + official_share_registry × 最新收盤 匯出，唯讀）
 * 權威來源：已採用的 stock_industry_map；舊 overlay 不得覆蓋審核後產業鏈。
 */
import fs from 'node:fs';
import path from 'node:path';
import { assignCodes, composePeerSymbols, industryCodeOf, reviewedPeerOverride, type IndustryCode, type PeerOverride } from '../src/checkup/lib/industryCodes';

const DATA = path.resolve('src/checkup/data');
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const SECTORS: Record<string, string> = {
  半導體: 'SEMI', 電子零組件: 'ECMP', 電腦及週邊: 'COMP', 通信網路: 'COMM', 軟體及服務: 'SOFT', 電機機械: 'MECH',
  汽車及運輸: 'AUTO', 金融: 'FINA', 生技醫療: 'BIOM', 原物料: 'MATL', 消費及服務: 'CONS', 營建能源: 'ENGY', 其他: 'OTHR',
};
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const N = 12;

const taxonomy = read('industryTaxonomy.json').groups as Record<string, string[]>;
const codesPath = path.join(DATA, 'industryCodes.json');
const existing: IndustryCode[] = fs.existsSync(codesPath) ? JSON.parse(fs.readFileSync(codesPath, 'utf8')).codes : [];
const codes = assignCodes(taxonomy, SECTORS, existing);

const dump = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) as Array<{ s: string; n: string | null; i: string | null; industries: string[]; adopted: boolean; cap: number | null }>;
if (!Array.isArray(dump) || dump.some((d) => typeof d.adopted !== 'boolean' || !Array.isArray(d.industries))) {
  throw new Error('同業匯出必須包含 adopted 與 industries，不接受未經採用閘門的舊格式');
}
const names = new Map(dump.map((d) => [d.s, d.n]));
const stocks = dump.map((d) => {
  const ind = d.adopted === true ? d.i : null;
  return { symbol: d.s, industry: ind, adopted: d.adopted === true, codes: (d.industries ?? []).map((i) => industryCodeOf(i, codes)).filter((c): c is string => !!c), cap: d.cap, code: industryCodeOf(ind, codes) };
});
const unmapped = stocks.filter((s) => !s.code);
const codeOfSym = new Map(stocks.map((s) => [s.symbol, s.code]));

// 舊名單 → 代碼 + 人工加入覆蓋（人工確認的成員全部保留）
const old = read('valuationPeerGroups.json').groups as Array<{ key: string; label: string; pickedAt: string; symbols: string[]; code?: string | null; include?: string[]; exclude?: string[]; custom?: boolean }>;
const overrides: PeerOverride[] = [];
const oldUnmatched: string[] = [];
for (const g of old) {
  let code = g.code ?? industryCodeOf(g.label, codes);
  const custom = g.custom ?? !code;
  if (!code) {
    const tally = new Map<string, number>();
    for (const s of g.symbols) { const c = codeOfSym.get(s); if (c) tally.set(c, (tally.get(c) ?? 0) + 1); }
    code = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    if (!code) oldUnmatched.push(g.label);
  }
  overrides.push(reviewedPeerOverride({ code, key: g.key, label: g.label, pickedAt: g.pickedAt, include: g.include ?? g.symbols, exclude: g.exclude ?? [], custom }, stocks));
}

const groups: any[] = [];
for (const o of overrides.filter((o) => o.custom)) {
  groups.push({ key: o.key, code: o.code, label: o.label, custom: true, curation: 'manual', pickedAt: o.pickedAt, include: o.include, exclude: o.exclude, symbols: o.include.filter((s) => !o.exclude.includes(s)) });
}
for (const c of codes.filter((c) => !c.retired)) {
  const o = overrides.find((x) => !x.custom && x.code === c.code) ?? null;
  const symbols = composePeerSymbols(c.code, stocks, o, N);
  if (!symbols.length) continue;
  groups.push({ key: c.code, code: c.code, label: c.name, curation: o ? 'manual' : 'auto', pickedAt: o?.pickedAt ?? TODAY, include: o?.include ?? [], exclude: o?.exclude ?? [], symbols });
}

fs.writeFileSync(codesPath, JSON.stringify({ _note: '細分產業固定代碼表。代碼永不改號、不重用；改名舊名進 aliases；字典移除者標 retired。由 scripts/build-peer-groups.ts 產生。', sectors: SECTORS, codes }, null, 1) + '\n');
fs.writeFileSync(path.join(DATA, 'valuationPeerGroups.json'), JSON.stringify({
  _note: '估值站牌同業名單，只採用通過審核閘門的分類：同主產業代碼、市值前 12；include 保留原人工意圖，未採用或不符產業的成員加入 exclude；custom 為人工跨產業組。由 scripts/build-peer-groups.ts 產生，勿手改 symbols。',
  generatedAt: TODAY, groups,
}, null, 1) + '\n');

const report = process.argv[3];
if (report) {
  const nm = (s: string) => `${s} ${names.get(s) ?? ''}`.trim();
  const L: string[] = [`# 產業代碼表與同業名單（${TODAY}）`, '', `- 細分產業代碼 ${codes.filter((c) => !c.retired).length} 個；同業名單 ${groups.length} 組（人工確認 ${groups.filter((g) => g.curation === 'manual').length}、新增自動 ${groups.filter((g) => g.curation === 'auto').length}）`, `- 全市場 ${stocks.length} 檔，主產業對不到代碼 ${unmapped.length} 檔；舊名單對不到代碼 ${oldUnmatched.length} 組`, ''];
  L.push('## 名單（代碼｜產業｜類型｜成員；＋為本次自動補入）', '');
  for (const g of groups) {
    const add = g.symbols.filter((s: string) => !g.include.includes(s));
    L.push(`### ${g.code ?? '—'}｜${g.label}｜${g.custom ? '人工自訂' : g.curation === 'manual' ? '人工確認' : '自動'}（${g.symbols.length} 家）`, '', g.symbols.map((s: string) => (add.includes(s) ? '＋' : '') + nm(s)).join('、'), '');
  }
  L.push('## 細分產業代碼', '', '| 代碼 | 細分產業 | 大類 | 別名 |', '|---|---|---|---|');
  for (const c of codes) L.push(`| ${c.code} | ${c.name}${c.retired ? '（停用）' : ''} | ${c.sector} | ${c.aliases.join('、')} |`);
  L.push('', '## 主產業對不到代碼的股票（不硬猜，未列入任何自動名單）', '');
  const by = new Map<string, string[]>();
  for (const s of unmapped) { const k = s.industry || '（無主產業）'; by.set(k, [...(by.get(k) ?? []), nm(s.symbol)]); }
  for (const [k, v] of [...by.entries()].sort((a, b) => b[1].length - a[1].length)) L.push(`- ${k}（${v.length}）：${v.join('、')}`);
  if (oldUnmatched.length) L.push('', '## 舊名單對不到代碼', '', ...oldUnmatched.map((x) => `- ${x}`));
  fs.writeFileSync(report, L.join('\n') + '\n');
}
console.log(JSON.stringify({ codes: codes.length, groups: groups.length, unmapped: unmapped.length, oldUnmatched }));
