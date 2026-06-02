export const fmtMoney = (n: number) => `NT$${(n || 0).toLocaleString()}`;

export const fmtDate = (d?: string | null) => {
  if (!d) return '-';
  const x = new Date(d);
  return `${x.getFullYear()}/${String(x.getMonth() + 1).padStart(2, '0')}/${String(x.getDate()).padStart(2, '0')}`;
};

export const fmtDateTime = (d?: string | null) => {
  if (!d) return '-';
  const x = new Date(d);
  return `${fmtDate(d)} ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
};

export function exportCSV(filename: string, rows: (string | number)[][]) {
  const csv = rows.map(r => r.map(c => {
    const s = String(c ?? '');
    return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const ruleSourceLabels: Record<string, string> = {
  plan_override: '方案覆寫',
  standard_default: '標準預設',
  checkup_default: '健檢預設',
};
