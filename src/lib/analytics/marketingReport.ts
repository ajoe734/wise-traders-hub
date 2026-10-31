/** 行銷來源報表：純函式（轉換率、CSV）。只處理彙總數字，不含個資。 */
export interface SourceRow {
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  visitors: number;
  signups: number;
  purchases: number;
  revenue: number;
  leads: number;
}

/** 轉換率 = 購買數 ÷ 訪客數；訪客 0 時回 null（不顯示假 0%）。 */
export function conversionRate(purchases: number, visitors: number): number | null {
  return visitors > 0 ? purchases / visitors : null;
}

export function signupRate(signups: number, visitors: number): number | null {
  return visitors > 0 ? signups / visitors : null;
}

const pct = (r: number | null) => (r === null ? '' : (r * 100).toFixed(2) + '%');

function cell(v: string | number): string {
  const s = String(v);
  // 防 CSV 公式注入
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: SourceRow[]): string {
  const header = ['utm_medium', 'utm_campaign', 'utm_content', '訪客數', '註冊數', '購買數', '營收', '活動報名數', '註冊轉換率', '購買轉換率'];
  const lines = rows.map((r) => [
    r.utm_medium, r.utm_campaign, r.utm_content, r.visitors, r.signups, r.purchases, r.revenue, r.leads,
    pct(signupRate(r.signups, r.visitors)), pct(conversionRate(r.purchases, r.visitors)),
  ].map(cell).join(','));
  return '\uFEFF' + [header.join(','), ...lines].join('\n');
}

export function totals(rows: SourceRow[]): Omit<SourceRow, 'utm_medium' | 'utm_campaign' | 'utm_content'> {
  return rows.reduce((a, r) => ({
    visitors: a.visitors + r.visitors, signups: a.signups + r.signups, purchases: a.purchases + r.purchases,
    revenue: a.revenue + r.revenue, leads: a.leads + r.leads,
  }), { visitors: 0, signups: 0, purchases: 0, revenue: 0, leads: 0 });
}
