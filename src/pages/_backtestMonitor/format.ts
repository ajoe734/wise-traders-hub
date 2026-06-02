export const fmtDateTime = (s: string | null) => {
  if (!s) return '—';
  const d = new Date(s);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fmtPct = (v: number | null) =>
  v == null ? '—' : `${(Number(v) * 100).toFixed(1)}%`;
