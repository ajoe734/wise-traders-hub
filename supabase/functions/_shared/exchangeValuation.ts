/**
 * 交易所公告每日本益比／淨值比／殖利率（純函式，Deno 與 Vitest 共用）。
 * 上市：證交所 BWIBBU_d（欄位：代號,名稱,收盤,殖利率,股利年度,本益比,淨值比,財報年季）。
 * 上櫃：櫃買 pera_result（欄位：代號,名稱,本益比,每股股利,股利年度,殖利率,淨值比,財報年季）。
 * 「-」或 ≤0 一律 null（虧損不公告本益比），不得寫 0。
 */
export type ExchangeRow = { symbol: string; trade_date: string; per: number | null; pbr: number | null; dividend_yield: number | null; market: 'TWSE' | 'TPEx'; source: string };

const pos = (v: unknown) => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };
const nonNeg = (v: unknown) => { const s = String(v ?? '').trim(); if (!s || s === '-') return null; const n = Number(s.replace(/,/g, '')); return Number.isFinite(n) && n >= 0 ? n : null; };
const okCode = (s: string) => /^\d{4,6}$/.test(s);

export function twseBwibbuUrl(date: string) { return `https://www.twse.com.tw/exchangeReport/BWIBBU_d?response=json&date=${date.replace(/-/g, '')}&selectType=ALL`; }
export function tpexPeraUrl(date: string) { const [y, m, d] = date.split('-'); return `https://www.tpex.org.tw/web/stock/aftertrading/peratio_analysis/pera_result.php?l=zh-tw&o=json&d=${Number(y) - 1911}/${m}/${d}`; }

export function parseTwseBwibbu(json: any, date: string): ExchangeRow[] {
  if (json?.stat !== 'OK' || !Array.isArray(json?.data)) return [];
  return json.data.map((r: any[]) => ({ symbol: String(r[0]).trim(), trade_date: date, per: pos(r[5]), pbr: pos(r[6]), dividend_yield: nonNeg(r[3]), market: 'TWSE' as const, source: 'twse_bwibbu' }))
    .filter((r: ExchangeRow) => okCode(r.symbol));
}

export function parseTpexPera(json: any, date: string): ExchangeRow[] {
  const rows = (json?.tables || []).flatMap((t: any) => (Array.isArray(t?.data) ? t.data : []));
  return rows.map((r: any[]) => ({ symbol: String(r[0]).trim(), trade_date: date, per: pos(r[2]), pbr: pos(r[6]), dividend_yield: nonNeg(r[5]), market: 'TPEx' as const, source: 'tpex_peratio' }))
    .filter((r: ExchangeRow) => okCode(r.symbol));
}
