/**
 * annualReportMix — 股東會年報「所營業務之營業比重」→ 產品營收占比 → 細分產業（純函式，前後端共用）
 *
 * 規則：
 *  - 只讀年報「營業比重」段落；每列取「產品名稱 + 最後一個百分比」。
 *  - 占比總和需落在 95–100.5，否則整份不採用（避免抓到錯表或漏列）。
 *  - 產品名稱需「完全等於」productSourceMap 的鍵才對到產業；對不上的產品照列，不猜。
 *  - 對不上的產品占比 ≥ 對上的第一名時，不能判定主業，交由 dominantIndustry 的領先門檻自然擋下。
 */
export interface ProductShare { product: string; pct: number }
export interface ParsedMix { products: ProductShare[]; total: number; reason: string | null }

const ANCHOR = /營業比重/;
const STOP = /^\s*(\d+[、.]|[（(]?[一二三四五六七八九十]+[）)、])\s*(公司目前|目前之|計畫開發|產業概況|商品|產品項目|主要產品)/;
const PCT = /(-?\d{1,3}(?:\.\d+)?)\s*%?\s*$/;

export function normalizeProduct(name: string): string {
  return name
    .replace(/[\s\u3000]+/g, '')
    .replace(/^[\-‧．・•．.、\d()（）A-Za-z]{0,3}[.、)）]/, '')
    .replace(/[：:]+$/, '')
    .replace(/^[：:]+/, '')
    .trim();
}

/** 從年報全文取「營業比重」段落的產品占比 */
export function parseProductShares(text: string): ParsedMix {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!ANCHOR.test(lines[i])) continue;
    const products: ProductShare[] = [];
    for (let j = i + 1; j < Math.min(lines.length, i + 40); j++) {
      const line = lines[j];
      if (STOP.test(line)) break;
      if (/合計|總計|小計|Total/i.test(line)) continue;
      const m = line.match(PCT);
      if (!m || !line.includes('%') && !/比重|%/.test(lines.slice(i, j).join(''))) continue;
      const pct = Number(m[1]);
      const head = line.slice(0, m.index).replace(/[\d,\s]+$/, '').replace(/[\d,]+(?:\s+[\d,]+)*\s*$/, '');
      const product = normalizeProduct(head.replace(/\s{2,}.*$/, (s) => s).replace(/[\d,.]+/g, ' ').split(/\s{2,}/)[0] ?? '');
      if (!product || product.length > 20 || !Number.isFinite(pct) || pct < 0 || pct > 100) continue;
      if (/年度|單位|仟元|千元|金額|比重|產品別|項目/.test(product)) continue;
      products.push({ product, pct });
    }
    if (products.length === 0) continue;
    const total = Math.round(products.reduce((s, p) => s + p.pct, 0) * 100) / 100;
    if (total < 95 || total > 100.5) return { products, total, reason: `營業比重總和${total}%無法核對` };
    return { products, total, reason: null };
  }
  return { products: [], total: 0, reason: '年報找不到營業比重段落' };
}

export type ProductSourceMap = Record<string, string>;

/** 產品占比 → 細分產業占比；只採完全一致的產品名稱 */
export function mapProductShares(products: ProductShare[], map: ProductSourceMap, isValidIndustry: (n: string) => boolean): {
  mix: Array<{ industry: string; pct: number }>;
  unmapped: ProductShare[];
} {
  const mix: Array<{ industry: string; pct: number }> = [];
  const unmapped: ProductShare[] = [];
  for (const p of products) {
    const ind = map[normalizeProduct(p.product)];
    if (ind && isValidIndustry(ind)) mix.push({ industry: ind, pct: p.pct });
    else unmapped.push(p);
  }
  // 未對照產品以「未對照」佔位，讓它參與第二名比較，不會讓已對上的產品假性領先
  for (const u of unmapped) mix.push({ industry: `未對照:${u.product}`, pct: u.pct });
  return { mix, unmapped };
}
