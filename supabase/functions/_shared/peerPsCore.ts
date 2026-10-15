// 純函式：同業每日 PS 倍數。PS = 當日收盤 ÷ 近四季每股營收（sps，與本檔站牌同一套 computeCompanyBasis 口徑）。
// 每股營收按季更新（下一季法定申報期限過後才重算）；收盤每天取證交所／櫃買全市場一次。與 Vitest 共用。

export type SalesBasis = { symbol: string; sps: number; latest_period: string; computed_at: string };
export type Close = { symbol: string; date: string; close: number };

/** 民國 1151014 → 2026-10-14；格式不符回 null。 */
export function rocDateToIso(roc: string): string | null {
  const m = String(roc || '').trim().match(/^(\d{3})(\d{2})(\d{2})$/);
  return m ? `${Number(m[1]) + 1911}-${m[2]}-${m[3]}` : null;
}

const num = (v: unknown) => { const n = Number(String(v ?? '').replace(/,/g, '').trim()); return Number.isFinite(n) && n > 0 ? n : null; };

/** 證交所 STOCK_DAY_ALL 與櫃買 tpex_mainboard_daily_close_quotes → 收盤（只留 4 碼普通股，停牌／無價丟棄）。 */
export function parseCloses(twse: Array<Record<string, string>>, tpex: Array<Record<string, string>>): Close[] {
  const out: Close[] = [];
  for (const r of twse ?? []) {
    const date = rocDateToIso(r.Date); const close = num(r.ClosingPrice);
    if (/^\d{4}$/.test(r.Code ?? '') && date && close) out.push({ symbol: r.Code, date, close });
  }
  for (const r of tpex ?? []) {
    const date = rocDateToIso(r.Date); const close = num(r.Close); const code = String(r.SecuritiesCompanyCode ?? '').trim();
    if (/^\d{4}$/.test(code) && date && close) out.push({ symbol: code, date, close });
  }
  return out;
}

/** 下一季季末（2026-06-30 → 2026-09-30）。 */
export function nextQuarterEnd(periodEnd: string): string {
  const [y, m] = periodEnd.split('-').map(Number);
  const nm = m + 3; const ny = nm > 12 ? y + 1 : y; const mm = nm > 12 ? nm - 12 : nm;
  const last = new Date(Date.UTC(ny, mm, 0)).getUTCDate();
  return `${ny}-${String(mm).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

/** 下一季法定申報期限：Q1 5/15、Q2 8/14、Q3 11/14、Q4 隔年 3/31。 */
export function filingDeadline(periodEnd: string): string {
  const [y, m] = periodEnd.split('-').map(Number);
  if (m === 3) return `${y}-05-15`;
  if (m === 6) return `${y}-08-14`;
  if (m === 9) return `${y}-11-14`;
  return `${y + 1}-03-31`;
}

/** 需要重算每股營收：沒有紀錄，或下一季申報期限已過且上次計算早於期限。 */
export function needsBasisRefresh(b: SalesBasis | null | undefined, today: string): boolean {
  if (!b) return true;
  const deadline = filingDeadline(nextQuarterEnd(b.latest_period));
  return today > deadline && b.computed_at.slice(0, 10) <= deadline;
}

/** 當日 PS 列；sps 無效或收盤缺漏不產生（不補值）。 */
export function psRows(bases: SalesBasis[], closes: Close[]): Array<{ symbol: string; trade_date: string; ps: number; close: number; sps: number }> {
  const bySym = new Map(closes.map((c) => [c.symbol, c]));
  const out = [];
  for (const b of bases) {
    const c = bySym.get(b.symbol);
    if (!c || !(b.sps > 0)) continue;
    out.push({ symbol: b.symbol, trade_date: c.date, ps: Math.round((c.close / b.sps) * 10000) / 10000, close: c.close, sps: b.sps });
  }
  return out;
}
