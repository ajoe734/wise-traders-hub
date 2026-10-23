/**
 * annualReportMix — 股東會年報「營業比重」→ 產品營收占比 → 細分產業（純函式，前後端共用）
 *
 * 規則：
 *  - 只讀年報「營業比重」段落，支援直式（每列：產品…百分比，可跨頁）與橫式（產品列＋百分比列）。
 *  - 多欄年度時取每列最後一個百分比（年報慣例最新年度在右）。
 *  - 占比總和需落在 95–100.5，否則整份不採用。
 *  - 產品名稱需「完全等於」productSourceMap 的鍵才對到產業；對不上的產品照列，各自佔一名參與排名，不猜。
 */
export interface ProductShare { product: string; pct: number }
export interface ParsedMix { products: ProductShare[]; total: number; reason: string | null }

const ANCHOR = /營業比重|營業比例|營收比重/;
const STOP = /^\s*(?:[（(]?[一二三四五六七八九十]+[）)、]|\d+\s*[.、．]|[（(]\d+[）)])\s*(?!\d)(?:公司目前|目前|計[畫劃]開發|產業概況|現有|主要產品之|新商品|新產品)/;
const STOP2 = /^\s*(公司目前|目前之商品|目前之產品|計[畫劃]開發|[（(]二[）)]\s*產業概況)/;
const NUM = /^-?[\d,]+(?:\.\d+)?%?$/;
const SKIP_NAME = /^(合計|合併|個體|總合計|營業收入合計|營收淨額|營業收入淨額|總計|小計|總額|Total|其他合計|產品名稱|產品|項目|營業內容|主要產品|年度|單位|金額|比重|產品別|營業項目|品名|類別)$/i;

export function normalizeProduct(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[$＄][\d,]*/g, '')
    .replace(/^(?:\(?\d{1,2}[)）.、]|[（(][一二三四五六七八九十\d]+[)）]|[‧・•．\-])/, '')
    .replace(/[：:]+$/, '')
    .replace(/(占|佔|約|為)+$/, '')
    .trim();
}

const pctOf = (tok: string): number | null => {
  const t = tok.replace(/%$/, '');
  if (!/^\d{1,3}(?:\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return n >= 0 && n <= 100 ? n : null;
};

function finalize(products: ProductShare[]): ParsedMix {
  const total = Math.round(products.reduce((s, p) => s + p.pct, 0) * 100) / 100;
  if (total < 95 || total > 100.5) return { products, total, reason: `營業比重總和${total}%無法核對` };
  return { products, total, reason: null };
}

const UNIT = /^(公噸|噸|千碼|碼|台|組|片|個|件|KG|kg|千個|千片|平方米|M2|m2|千元|仟元|元|%|％)$/;
const isNumTok = (t: string) => t === '-' || NUM.test(t);

function parseRows(lines: string[]): ProductShare[] {
  // 同名產品保留最後一次（多年度或個體／合併並列時取後者）
  const out = new Map<string, number>();
  for (const line of lines) {
    const toks = line.trim().replace(/％/g, '%').split(/\s+/).filter(Boolean);
    let k = 0;
    const name: string[] = [];
    while (k < toks.length && !isNumTok(toks[k])) name.push(toks[k++]);
    while (name.length && UNIT.test(name[name.length - 1])) name.pop();
    const nums: string[] = [];
    while (k < toks.length && isNumTok(toks[k])) nums.push(toks[k++]);
    if (!name.length || !nums.length) continue;
    const last = nums[nums.length - 1];
    if (last === '-') continue;
    const pct = pctOf(last);
    if (pct === null) continue;
    if (nums.length === 1 && !last.endsWith('%') && !last.includes('.') && Number(last) > 100) continue;
    const product = normalizeProduct(name.join(''));
    if (!product || product.length > 24 || SKIP_NAME.test(product) || /合計|總計|小計|淨額|比重|比率|單位|年度/.test(product) || /^\d/.test(product)) continue;
    out.delete(product);
    out.set(product, pct);
  }
  return [...out.entries()].map(([product, pct]) => ({ product, pct }));
}

function parseInline(text: string): ProductShare[] {
  const out = new Map<string, number>();
  const flat = text.replace(/\s+/g, '').replace(/％/g, '%');
  for (const m of flat.matchAll(/([\u4e00-\u9fffA-Za-z/&()（）]{2,24})[：:]?(\d{1,3}(?:\.\d+)?)%/g)) {
    const product = normalizeProduct(m[1].replace(/^(為|分別為|如下|比重|營業比重)+/, ''));
    if (!product || /合計|總計|小計/.test(product)) continue;
    out.delete(product); out.set(product, Number(m[2]));
  }
  return [...out.entries()].map(([product, pct]) => ({ product, pct }));
}

function parseColumns(lines: string[]): ProductShare[] {
  for (let i = 0; i + 1 < lines.length; i++) {
    const names = lines[i].trim().split(/\s{2,}/).filter(Boolean);
    if (names.length < 2 || names.some((n) => /\d/.test(n))) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
      const vals = lines[j].trim().split(/\s+/).filter(Boolean);
      if (vals.length !== names.length) continue;
      const pcts = vals.map(pctOf);
      if (pcts.some((p) => p === null) || !vals.some((v) => v.endsWith('%') || v.includes('.'))) continue;
      return names.map((n, k) => ({ product: normalizeProduct(n), pct: pcts[k] as number }));
    }
  }
  return [];
}

/** 從年報全文取「營業比重」段落的產品占比：先試所有段落的表格，再退回段落內文 */
export function parseProductShares(text: string): ParsedMix {
  const lines = text.split(/\r?\n/);
  const blocks: string[][] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!ANCHOR.test(lines[i])) continue;
    const block: string[] = [];
    const tail = lines[i].split(ANCHOR).pop() ?? '';
    if (tail.trim()) block.push(tail);
    for (let j = i + 1; j < Math.min(lines.length, i + 260); j++) {
      if (STOP.test(lines[j]) || STOP2.test(lines[j])) break;
      block.push(lines[j]);
    }
    blocks.push(block);
  }
  let firstBad: ParsedMix | null = null;
  const parsers: Array<(b: string[]) => ProductShare[]> = [
    parseColumns,
    (b) => parseRows(b.map((l) => l.replace(/[:：]/g, '  '))),
    (b) => parseInline(b.join('\n')),
  ];
  for (const parse of parsers) {
    for (const block of blocks) {
      const cand = parse(block);
      if (cand.length === 0) continue;
      const r = finalize(cand);
      if (!r.reason) return r;
      firstBad ??= r;
    }
  }
  return firstBad ?? { products: [], total: 0, reason: '年報找不到營業比重段落' };
}

export type ProductSourceMap = Record<string, string>;

import { UNMAPPED as UNMAPPED_PREFIX } from './chainClassification.ts';
export { UNMAPPED_PREFIX };

/** 產品占比 → 細分產業占比；只採完全一致的產品名稱，對不上的各自佔位參與排名 */
export function mapProductShares(products: ProductShare[], map: ProductSourceMap, isValidIndustry: (n: string) => boolean): {
  mix: Array<{ industry: string; pct: number }>;
  unmapped: ProductShare[];
} {
  const mix: Array<{ industry: string; pct: number }> = [];
  const unmapped: ProductShare[] = [];
  for (const p of products) {
    const ind = map[normalizeProduct(p.product)];
    if (ind && isValidIndustry(ind)) mix.push({ industry: ind, pct: p.pct });
    else { unmapped.push(p); mix.push({ industry: UNMAPPED_PREFIX + p.product, pct: p.pct }); }
  }
  return { mix, unmapped };
}
