import { isValidIndustry, isValidMarketGroup } from '@/checkup/lib/industryTaxonomy';

export function validateReview(industries: string[], groups: string[]): string | null {
  if (!industries.length || industries.length > 3 || industries.some((i) => !isValidIndustry(i))) return '請選擇字典內的細分產業（1–3 個）';
  if (groups.length > 3 || groups.some((g) => !isValidMarketGroup(g))) return '請選擇字典內的市場族群（最多 3 個）';
  return null;
}

export function reviewCsv(rows: Array<{ symbol: string; name?: string | null; official_industry?: string | null; industries?: string[] | null; business_desc?: string | null; evidence?: string | null }>): string {
  const quote = (v: string) => `"${(/^[=+@\-\t\r]/.test(v) ? "'" : '') + v.replace(/"/g, '""')}"`;
  return '\uFEFF' + [['代號', '名稱', '官方大類', '目前細分產業', '主要經營業務', '依據', '確認／修正產業', '補充依據'], ...rows.map((r) => [r.symbol, r.name ?? '', r.official_industry ?? '', r.industries?.join('、') ?? '', r.business_desc ?? '', r.evidence ?? '', '', ''])].map((r) => r.map(quote).join(',')).join('\r\n');
}